import { z } from 'zod';

export const requestKindSchema = z.enum(['generate', 'finalize']);
export const requestStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const requestCreatedBySchema = z.enum(['brain', 'mcp', 'gui', 'system']);

export const jsonObject = z.record(z.string(), z.unknown());

/** worker-protocol.md: `recipe_ref` は origin のブランチ名相当の文字列だけを検証し、存在は確認しない。 */
export const RECIPE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/**
 * finalize の options は `comfy-recipes finalize` の引数に 1 対 1 で写す
 * (docs/worker-protocol.md「finalize」節の表)。組み合わせの妥当性 (recipe が
 * route を持つか等) は worker が判定して failed にする — chimera が見るのは型だけ。
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
  })
  .strict();

export const finalizePayloadSchema = z
  .object({
    generation_id: z.string().min(1),
    options: finalizeOptionsSchema.optional(),
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
export function payloadEnvelopeIssues(kind: 'generate' | 'finalize', payload: unknown) {
  const parsed = kind === 'finalize' ? finalizePayloadSchema.safeParse(payload) : generatePayloadSchema.safeParse(payload);
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
