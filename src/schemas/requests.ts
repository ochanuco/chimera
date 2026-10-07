import { z } from 'zod';

export const requestKindSchema = z.enum(['generate', 'finalize', 'redraw', 'repair', 'masked_redraw', 'deliver']);
/** 出力と絞り込み用。import は worker が claim せず、登録側が done で作る Request で、生成要求の入力には使えない。 */
export const requestKindFilterSchema = z.enum(['generate', 'finalize', 'redraw', 'repair', 'masked_redraw', 'deliver', 'import']);
export const requestStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const requestCreatedBySchema = z.enum(['brain', 'mcp', 'gui', 'system']);

export const jsonObject = z.record(z.string(), z.unknown());

/** worker-protocol.md: `recipe_ref` は origin のブランチ名相当の文字列だけを検証し、存在は確認しない。 */
export const RECIPE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/** catalog の `dials` が定義する word の語彙 (docs/worker-protocol.md「finalize profile」)。実在するかは worker が検証、chimera は型だけ見る。 */
export const DIAL_WORD_RE = /^[a-z][a-z0-9-]*$/;
const dialWord = z.string().regex(DIAL_WORD_RE);

/** repair region は width/height に対する分数の矩形 [x0,y0,x1,y1] (x0<x1, y0<y1)。
 * 単体の repair request (`regions`) と finalize 相乗りの repair (`repair_regions`) で共有。 */
const repairRegionSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, {
    message: 'region must have x0 < x1 and y0 < y1',
  });

/** Same coordinate convention as repair, but deliberately a separate schema: masked redraw requires
 * >=1 rectangle and rejects overlaps so the worker gets an unambiguous mask union. */
export const maskedRedrawRegionSchema = repairRegionSchema;

function regionsOverlap(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** finalize の options は `comfy-recipes finalize` の引数に 1 対 1 で写す (docs/worker-protocol.md「finalize」)。
 * 組み合わせの妥当性は worker が判定して failed にする — chimera は型だけ見る。
 * `repair*` は相乗り repair の引数で、単体 repair request の options と語彙を揃えている。 */
const denoiseField = z.union([z.number(), dialWord]).nullable().optional();
const keepLegwearField = z.union([z.literal(true), z.number(), dialWord]).nullable().optional();
const routeField = z.enum(['latent', 'pixel']).nullable().optional();
const finalizerField = z.string().nullable().optional();
const sizeField = z.number().int().nullable().optional();
const upscaleField = z.enum(['bicubic', 'nearest-exact', 'bilinear', 'lanczos']).nullable().optional();
// worker は keep_regions / keep_strength の null を型エラーにするので、他の option と違い nullable にしない。
const keepRegionsField = z.array(repairRegionSchema).optional();
const keepStrengthField = z.number().gt(0).lt(1).optional();
const hiresField = z.number().int().min(64).nullable().optional();
const hiresDenoiseField = z.number().gt(0).lte(1).nullable().optional();
const repinField = z.boolean().optional();
const recolorField = z.boolean().optional();
const skinField = z.boolean().optional();
const keepSceneField = z.boolean().optional();
const transparentField = z.boolean().nullable().optional();
const backdropField = z.string().nullable().optional();
const strokeLightField = z.enum(['none', 'even', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).nullable().optional();
const deliverSizeField = z.number().int().nullable().optional();
const dofField = z
  .object({
    focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    f_number: z.number().min(1.4).max(22),
    scope: z.enum(['figure', 'all']).optional(),
    viewfinder: z.enum(['off', 'on', 'both']).optional(),
  })
  .strict()
  .nullable()
  .optional();
const lightSceneField = z.enum(['sunset', 'moon']);
const lightFromField = z.enum(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).optional();
const lightField = z
  .object({ scene: lightSceneField, from: lightFromField })
  .strict()
  .nullable()
  .optional();

/** finalize の options は `comfy-recipes finalize` の引数に 1 対 1 で写す (docs/worker-protocol.md「finalize」)。
 * 組み合わせの妥当性は worker が判定して failed にする — chimera は型だけ見る。
 * `repair*` は相乗り repair の引数で、単体 repair request の options と語彙を揃えている。 */
export const finalizeOptionsSchema = z
  .object({
    denoise: denoiseField,
    repin: repinField,
    recolor: recolorField,
    keep_legwear: keepLegwearField,
    route: routeField,
    finalizer: finalizerField,
    size: sizeField,
    skin: skinField,
    keep_scene: keepSceneField,
    transparent: transparentField,
    backdrop: backdropField,
    upscale: upscaleField,
    deliver_size: deliverSizeField,
    stroke_light: strokeLightField,
    repair: z.array(z.enum(['hands', 'feet'])).nullable().optional(),
    repair_regions: z.array(repairRegionSchema).nullable().optional(),
    repair_denoise: z.union([z.number().gt(0).lte(1), dialWord]).nullable().optional(),
    repair_pad: z.number().min(0.5).max(3).nullable().optional(),
    repair_size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    repair_lora: z.union([z.literal(true), z.number(), dialWord]).nullable().optional(),
    repair_seeds: z.number().int().min(1).max(8).optional(),
    keep_regions: keepRegionsField,
    keep_strength: keepStrengthField,
    deliver_only: z.boolean().optional(),
    hires: hiresField,
    hires_denoise: hiresDenoiseField,
    dof: dofField,
    light: lightField,
  })
  .strict();

/** redraw の options は絵を変える 1 つの method だけを選ぶ (docs/worker-protocol.md「redraw」)。 */
export const redrawOptionsSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('canvas'),
      denoise: denoiseField,
      size: sizeField,
      route: routeField,
      finalizer: finalizerField,
      upscale: upscaleField,
      keep_regions: keepRegionsField,
      keep_strength: keepStrengthField,
    })
    .strict(),
  z.object({ method: z.literal('hires'), hires: hiresField, denoise: hiresDenoiseField }).strict(),
  z.object({ method: z.literal('light'), scene: lightSceneField.optional(), from: lightFromField }).strict(),
]);

/** deliver の options は切り抜き後の飾りだけ (docs/worker-protocol.md「deliver」)。 */
export const deliverOptionsSchema = z
  .object({
    repin: repinField,
    recolor: recolorField,
    skin: skinField,
    keep_legwear: keepLegwearField,
    keep_scene: keepSceneField,
    transparent: transparentField,
    backdrop: backdropField,
    stroke_light: strokeLightField,
    deliver_size: deliverSizeField,
    dof: dofField,
    light: lightField,
  })
  .strict();

export const redrawPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: redrawOptionsSchema,
  })
  .strict();

export const deliverPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: deliverOptionsSchema.optional(),
  })
  .strict();

/** finalize payload の `profile` — a finalize preset の参照 (docs/worker-protocol.md「finalize profile」)。version 省略は最新 active 版。 */
export const finalizeProfileRefSchema = z
  .object({
    name: z.string().min(1),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const finalizePayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: finalizeOptionsSchema.optional(),
    profile: finalizeProfileRefSchema.optional(),
  })
  .strict();

/** repair の options は masked local redraw (hands/feet) の worker 側引数に写す (docs/worker-protocol.md「repair」)。chimera は型だけ見る。 */
export const repairOptionsSchema = z
  .object({
    parts: z.array(z.enum(['hands', 'feet'])).optional(),
    regions: z.array(repairRegionSchema).optional(),
    denoise: z.union([z.number().gt(0).lte(1), dialWord]).nullable().optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
    size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    pad: z.number().min(0.5).max(3).nullable().optional(),
    lora: z.union([z.literal(true), z.number(), dialWord]).nullable().optional(),
  })
  .strict();

export const repairPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: repairOptionsSchema.optional(),
  })
  .strict();

/** Generic masked redraw keeps its strength in the low-to-medium inpaint range. */
export const MASKED_REDRAW_MAX_DENOISE = 0.75;

/** Generic masked-img2img/inpaint options. `mask_padding`/`mask_feather` are pixel distances the worker
 * applies after resolving image dimensions. `pad`/`feather` are compatibility aliases (shorter repair
 * vocabulary), canonicalized before a request is persisted. */
export const maskedRedrawOptionsSchema = z
  .object({
    regions: z.array(maskedRedrawRegionSchema).min(1, 'at least one region is required'),
    prompt_patch: z.string().trim().min(1, 'prompt_patch must not be empty').max(4096),
    denoise: z.union([z.number().gt(0).lte(MASKED_REDRAW_MAX_DENOISE), dialWord]).optional(),
    mask_padding: z.number().min(0).max(512).optional(),
    mask_feather: z.number().min(0).max(256).optional(),
    pad: z.number().min(0).max(512).optional(),
    feather: z.number().min(0).max(256).optional(),
    size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mask_padding !== undefined && value.pad !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'use either mask_padding or pad, not both', path: ['mask_padding'] });
    }
    if (value.mask_feather !== undefined && value.feather !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'use either mask_feather or feather, not both', path: ['mask_feather'] });
    }
    for (let i = 0; i < value.regions.length; i += 1) {
      for (let j = i + 1; j < value.regions.length; j += 1) {
        if (regionsOverlap(value.regions[i]!, value.regions[j]!)) {
          ctx.addIssue({
            code: 'custom',
            message: `region overlaps region ${j}`,
            path: ['regions', i],
          });
        }
      }
    }
  });

export const maskedRedrawPayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: maskedRedrawOptionsSchema,
  })
  .strict();

/** Canonicalizes to one stable vocabulary even when a caller uses aliases. Validation normally happens
 * at the REST/MCP boundary; parsing here also guards direct callers (e.g. request helpers). */
export function canonicalizeMaskedRedrawPayload(payload: unknown): Record<string, unknown> {
  const parsed = maskedRedrawPayloadSchema.parse(payload);
  const { pad, feather, ...options } = parsed.options;
  if (options.mask_padding === undefined && pad !== undefined) options.mask_padding = pad;
  if (options.mask_feather === undefined && feather !== undefined) options.mask_feather = feather;
  return { generation_id: parsed.generation_id, options };
}

/** generate の payload は request.json v1 をそのまま包む (generation-request.md)。chimera が検証するのは封筒の形だけで、中身の語彙は検証しない。 */
export const generatePayloadSchema = z
  .object({
    schema_version: z.literal(1),
    request: jsonObject,
    generation: jsonObject,
  })
  .passthrough();

/** REST (`POST /api/v1/requests`) と MCP `create_request` の両方が使う、kind に応じた payload 封筒の検証。 */
export function payloadEnvelopeIssues(kind: z.infer<typeof requestKindSchema>, payload: unknown) {
  const schema =
    kind === 'finalize'
      ? finalizePayloadSchema
      : kind === 'redraw'
        ? redrawPayloadSchema
        : kind === 'deliver'
          ? deliverPayloadSchema
          : kind === 'repair'
            ? repairPayloadSchema
            : kind === 'masked_redraw'
              ? maskedRedrawPayloadSchema
              : generatePayloadSchema;
  const parsed = schema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues;
}

const resolutionReferenceSchema = z
  .object({
    source_generation_id: z.string().min(1).optional(),
    generation_id: z.string().min(1).optional(),
    purpose: z.string().min(1).nullish(),
    aspect: z.string().min(1).nullish(),
    instruction: z.string().nullish(),
  })
  .superRefine((value, ctx) => {
    if (!value.source_generation_id && !value.generation_id) {
      ctx.addIssue({ code: 'custom', message: 'source_generation_id is required', path: ['source_generation_id'] });
    }
  });

/** worker が生成前に報告する解決済みの値 (docs/worker-protocol.md「Resolution」)。PUT /requests/{id}/resolution と import の作成が共有する。 */
const resolutionBaseShape = {
  recipe: z.string().nullish(),
  raw_instruction: z.string().nullish(),
  // target/op/reason の封筒だけ検証する。語彙は検証しない。
  patches: z
    .array(z.object({ target: z.string().min(1), op: z.string().min(1), reason: z.string().min(1) }).passthrough())
    .nullish(),
  pose_fingerprint: z.string().min(1).nullish(),
  preset_versions: z.array(z.unknown()).nullish(),
  git_commit: z.string().nullish(),
  git_dirty: z.boolean().nullish(),
  references: z.array(resolutionReferenceSchema).nullish(),
};

export const resolutionShape = { ...resolutionBaseShape, parameters: jsonObject };

function patchesNeedFingerprint(
  value: { patches?: unknown[] | null; pose_fingerprint?: string | null },
  ctx: z.RefinementCtx,
) {
  // patches があるのに fingerprint が無いと base_fingerprint が NULL になり drift 検出できなくなる (docs/domain-model.md「Preset」)。
  if ((value.patches?.length ?? 0) > 0 && !value.pose_fingerprint) {
    ctx.addIssue({ code: 'custom', message: 'pose_fingerprint is required when patches is non-empty', path: ['pose_fingerprint'] });
  }
}

export const putResolutionSchema = z
  .object({ ...resolutionShape, worker_id: z.string().min(1).optional() })
  .superRefine(patchesNeedFingerprint);

export type PutResolutionInput = z.infer<typeof putResolutionSchema>;

const RESOLUTION_KEYS = Object.keys(resolutionShape);

export const createRequestSchema = z
  .object({
    kind: requestKindFilterSchema,
    payload: jsonObject.optional(),
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
    idempotency_key: z.string().min(1),
    created_by: requestCreatedBySchema,
    /** import だけが done で作られる。他の kind は queued 固定で、指定できない。 */
    status: z.literal('done').optional(),
    /** import だけが受ける。worker を通さずに描いた Run の結果を、この Request として Run に紐付ける。 */
    run_id: z.string().min(1).optional(),
    ...resolutionBaseShape,
    parameters: jsonObject.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'import') {
      if (value.status !== 'done') {
        ctx.addIssue({ code: 'custom', message: "status must be 'done' for kind import", path: ['status'] });
      }
      if (!value.parameters) {
        ctx.addIssue({ code: 'custom', message: 'parameters is required for kind import', path: ['parameters'] });
      }
      patchesNeedFingerprint(value, ctx);
      return;
    }
    if (value.status !== undefined) {
      ctx.addIssue({ code: 'custom', message: "status is only accepted for kind import", path: ['status'] });
    }
    if (value.run_id !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'run_id is only accepted for kind import', path: ['run_id'] });
    }
    for (const key of RESOLUTION_KEYS) {
      if ((value as Record<string, unknown>)[key] !== undefined) {
        ctx.addIssue({ code: 'custom', message: `${key} is only accepted for kind import`, path: [key] });
      }
    }
    if (value.payload === undefined) {
      ctx.addIssue({ code: 'custom', message: 'payload is required', path: ['payload'] });
      return;
    }
    for (const issue of payloadEnvelopeIssues(value.kind, value.payload)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['payload', ...issue.path] });
    }
  });

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const claimRequestSchema = z.object({
  worker_id: z.string().min(1),
  kinds: z.array(requestKindSchema).min(1).optional(),
});

export type ClaimRequestInput = z.infer<typeof claimRequestSchema>;

/** `.passthrough()`: worker が done に添える `resolved_options` 等 (docs/worker-protocol.md「finalize profile」) を
 * 素の z.object が黙って落とさないため。chimera は不透明な JSON として保存するだけ。 */
export const updateRequestResultSchema = z
  .object({
    generation_ids: z.array(z.string().min(1)),
    recipe_commit: z.string().optional(),
  })
  .passthrough();

/** worker が書く running/queued/done/failed は claim 済みの worker_id を伴う (409 の元にするため)。brain/GUI の cancelled だけ持たない。 */
export const updateRequestSchema = z
  .object({
    status: z.enum(['running', 'queued', 'done', 'failed', 'cancelled']),
    worker_id: z.string().min(1).optional(),
    result: updateRequestResultSchema.optional(),
    error: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'cancelled' && !value.worker_id) {
      ctx.addIssue({ code: 'custom', message: 'worker_id is required for this status transition', path: ['worker_id'] });
    }
    if (value.status === 'failed' && !value.error) {
      ctx.addIssue({ code: 'custom', message: 'error is required when status is failed', path: ['error'] });
    }
    if (value.status === 'done' && !value.result) {
      ctx.addIssue({ code: 'custom', message: 'result is required when status is done', path: ['result'] });
    }
  });

export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
