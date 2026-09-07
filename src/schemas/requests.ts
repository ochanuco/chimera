import { z } from 'zod';

export const requestKindSchema = z.enum(['generate', 'finalize', 'repair']);
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
export function payloadEnvelopeIssues(kind: 'generate' | 'finalize' | 'repair', payload: unknown) {
  const schema = kind === 'finalize' ? finalizePayloadSchema : kind === 'repair' ? repairPayloadSchema : generatePayloadSchema;
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
 * worker が書く running/done/failed は claim 済みの worker_id を伴う (409 の元にする
 * ため)。brain/GUI が書く cancelled だけは worker_id を持たない。
 */
export const updateRequestSchema = z
  .object({
    status: z.enum(['running', 'done', 'failed', 'cancelled']),
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
