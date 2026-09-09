import { z } from 'zod';

export const requestKindSchema = z.enum(['generate', 'finalize', 'repair', 'masked_redraw']);
export const requestStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const requestCreatedBySchema = z.enum(['brain', 'mcp', 'gui', 'system']);

export const jsonObject = z.record(z.string(), z.unknown());

/** worker-protocol.md: `recipe_ref` は origin のブランチ名相当の文字列だけを検証し、存在は確認しない。 */
export const RECIPE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/**
 * repair の region は width/height に対する分数の矩形 [x0, y0, x1, y1] で、
 * x0<x1 かつ y0<y1 を要求する。単体の repair request (`regions`) と finalize
 * に相乗りする repair (`repair_regions`) が共有する。
 */
const repairRegionSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([x0, y0, x1, y1]) => x0 < x1 && y0 < y1, {
    message: 'region must have x0 < x1 and y0 < y1',
  });

/**
 * Generic masked redraw rectangles use the same normalized coordinate convention as repair,
 * but are deliberately a separate schema: a masked redraw must name at least one rectangle,
 * and overlapping rectangles are rejected so the worker receives an unambiguous mask union.
 */
export const maskedRedrawRegionSchema = repairRegionSchema;

function regionsOverlap(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * finalize の options は `comfy-recipes finalize` の引数に 1 対 1 で写す
 * (docs/worker-protocol.md「finalize」節の表)。組み合わせの妥当性 (recipe が
 * route を持つか等) は worker が判定して failed にする — chimera が見るのは型だけ。
 * `repair*` は同じリクエストに相乗りする repair (masked local redraw) の引数で、
 * 単体の repair request の options と語彙を揃えている。
 */
export const finalizeOptionsSchema = z
  .object({
    denoise: z.number().nullable().optional(),
    repin: z.boolean().optional(),
    recolor: z.boolean().optional(),
    keep_legwear: z.union([z.literal(true), z.number()]).nullable().optional(),
    route: z.enum(['latent', 'pixel']).nullable().optional(),
    finalizer: z.string().nullable().optional(),
    size: z.number().int().nullable().optional(),
    handdrawn: z.boolean().optional(),
    skin: z.boolean().optional(),
    toe_guard: z.union([z.literal(true), z.number()]).nullable().optional(),
    keep_scene: z.boolean().optional(),
    transparent: z.boolean().nullable().optional(),
    backdrop: z.string().nullable().optional(),
    upscale: z.enum(['bicubic', 'nearest-exact', 'bilinear', 'lanczos']).nullable().optional(),
    lora_strength: z.number().nullable().optional(),
    deliver_size: z.number().int().nullable().optional(),
    stroke_light: z.enum(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).nullable().optional(),
    repair: z.array(z.enum(['hands', 'feet'])).nullable().optional(),
    repair_regions: z.array(repairRegionSchema).nullable().optional(),
    repair_denoise: z.number().gt(0).lte(1).nullable().optional(),
    repair_pad: z.number().min(0.5).max(3).nullable().optional(),
    repair_size: z.number().int().min(256).multipleOf(8).nullable().optional(),
  })
  .strict();

export const finalizePayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: finalizeOptionsSchema.optional(),
  })
  .strict();

/**
 * repair の options は masked local redraw (hands/feet) の worker 側引数に写す
 * (docs/worker-protocol.md「repair」節の表)。finalize と同じく chimera が見るのは型だけ。
 */
export const repairOptionsSchema = z
  .object({
    parts: z.array(z.enum(['hands', 'feet'])).optional(),
    regions: z.array(repairRegionSchema).optional(),
    denoise: z.number().gt(0).lte(1).nullable().optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
    size: z.number().int().min(256).multipleOf(8).nullable().optional(),
    pad: z.number().min(0.5).max(3).nullable().optional(),
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

/**
 * Generic masked-img2img/inpaint options. `mask_padding` and `mask_feather` are pixel
 * distances applied by the worker after resolving the source image dimensions. `pad` and
 * `feather` are accepted as compatibility aliases for workers that use the shorter repair
 * vocabulary; both aliases are canonicalized before a request is persisted.
 */
export const maskedRedrawOptionsSchema = z
  .object({
    regions: z.array(maskedRedrawRegionSchema).min(1, 'at least one region is required'),
    prompt_patch: z.string().trim().min(1, 'prompt_patch must not be empty').max(4096),
    denoise: z.number().gt(0).lte(MASKED_REDRAW_MAX_DENOISE).optional(),
    mask_padding: z.number().min(0).max(512).optional(),
    mask_feather: z.number().min(0).max(256).optional(),
    // Narrow aliases keep the contract easy to adapt to comfyui-recipes' existing masked
    // redraw helper without changing the repair_generation semantics.
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

/**
 * Store one stable vocabulary in the queue even when a caller uses the short aliases.
 * Validation happens at the REST/MCP boundary; parsing here also protects direct callers
 * such as request helpers from persisting an invalid masked-redraw payload.
 */
export function canonicalizeMaskedRedrawPayload(payload: unknown): Record<string, unknown> {
  const parsed = maskedRedrawPayloadSchema.parse(payload);
  const { pad, feather, ...options } = parsed.options;
  if (options.mask_padding === undefined && pad !== undefined) options.mask_padding = pad;
  if (options.mask_feather === undefined && feather !== undefined) options.mask_feather = feather;
  return { generation_id: parsed.generation_id, options };
}

/**
 * generate の payload は request.json v1 をそのまま包む (generation-request.md)。
 * chimera が検証するのは封筒の形 (schema_version=1 と request/generation の存在)
 * だけで、中身の語彙は comfyui-recipes 側のものなので検証しない。
 */
export const generatePayloadSchema = z
  .object({
    schema_version: z.literal(1),
    request: jsonObject,
    generation: jsonObject,
  })
  .passthrough();

/** REST (`POST /api/v1/requests`) と MCP `create_request` の両方が使う、kind に応じた payload 封筒の検証。 */
export function payloadEnvelopeIssues(kind: 'generate' | 'finalize' | 'repair' | 'masked_redraw', payload: unknown) {
  const schema =
    kind === 'finalize'
      ? finalizePayloadSchema
      : kind === 'repair'
        ? repairPayloadSchema
        : kind === 'masked_redraw'
          ? maskedRedrawPayloadSchema
          : generatePayloadSchema;
  const parsed = schema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues;
}

export const createRequestSchema = z
  .object({
    kind: requestKindSchema,
    payload: jsonObject,
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
    idempotency_key: z.string().min(1),
    created_by: requestCreatedBySchema,
  })
  .superRefine((value, ctx) => {
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

export const updateRequestResultSchema = z.object({
  batch_id: z.string().min(1),
  generation_ids: z.array(z.string().min(1)),
  recipe_commit: z.string().optional(),
});

/**
 * worker が書く running/queued/done/failed は claim 済みの worker_id を伴う (409 の元にする
 * ため)。brain/GUI が書く cancelled だけは worker_id を持たない。
 */
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
