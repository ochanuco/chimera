import { z } from 'zod';
import type { StandardSchemaV1 } from '../lib/standard-schema';
import { createRequestIssues } from '../lib/request-payload';
import { RECIPE_REF_RE, patchesFingerprintIssues, resolutionReferenceIssues, updateRequestIssues } from '../lib/request-rules';
import { addIssues } from './issues';
import { jsonObject } from './request-payloads';

/** finalize は既存の行を読むためだけに残す。作成も claim もできない (FINALIZE_CREATION_MESSAGE)。
 * repair / masked_redraw も既存の行を読むためと、claim 済みの行を worker が扱うためにだけ残す。作成はできない (PARTIAL_FIX_CREATION_MESSAGE)。 */
export const requestKindSchema = z.enum(['generate', 'finalize', 'redraw', 'repair', 'masked_redraw', 'deliver', 'dof', 'lens', 'photo', 'stage', 'lighting', 'saturation', 'reference', 'reference_render']);
export const creatableRequestKindSchema = z.enum(['generate', 'redraw', 'deliver', 'dof', 'lens', 'photo', 'stage', 'lighting', 'saturation', 'reference']);
/** claim が受ける kind。作成できなくなった repair / masked_redraw も、積まれたままの行を worker が取れるように残す。 */
export const claimableRequestKindSchema = z.enum(['generate', 'redraw', 'repair', 'masked_redraw', 'deliver', 'dof', 'lens', 'photo', 'stage', 'lighting', 'saturation', 'reference', 'reference_render']);
/** 出力と絞り込み用。import は worker が claim せず、登録側が done で作る Request で、生成要求の入力には使えない。 */
export const requestKindFilterSchema = z.enum(['generate', 'finalize', 'redraw', 'repair', 'masked_redraw', 'deliver', 'dof', 'lens', 'photo', 'stage', 'lighting', 'saturation', 'reference', 'reference_render', 'import']);
export const requestStatusSchema = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export const requestCreatedBySchema = z.enum(['brain', 'mcp', 'gui', 'system']);

const resolutionReferenceSchema = z
  .object({
    source_generation_id: z.string().min(1).optional(),
    generation_id: z.string().min(1).optional(),
    purpose: z.string().min(1).nullish(),
    aspect: z.string().min(1).nullish(),
    instruction: z.string().nullish(),
  })
  .superRefine((value, ctx) => addIssues(ctx, resolutionReferenceIssues(value)));

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

export const putResolutionSchema = z
  .object({ ...resolutionShape, worker_id: z.string().min(1).optional() })
  .superRefine((value, ctx) => addIssues(ctx, patchesFingerprintIssues(value)));

export type PutResolutionInput = StandardSchemaV1.InferOutput<typeof putResolutionSchema>;

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
  .superRefine((value, ctx) => addIssues(ctx, createRequestIssues(value, RESOLUTION_KEYS)));

export type CreateRequestInput = StandardSchemaV1.InferOutput<typeof createRequestSchema>;

export const claimRequestSchema = z.object({
  worker_id: z.string().min(1),
  kinds: z.array(claimableRequestKindSchema).min(1).optional(),
});

export type ClaimRequestInput = StandardSchemaV1.InferOutput<typeof claimRequestSchema>;

/** `.passthrough()`: worker が done に添える `resolved_options` 等 (docs/worker-protocol.md「deliver profile」) を
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
  .superRefine((value, ctx) => addIssues(ctx, updateRequestIssues(value)));

export type UpdateRequestInput = StandardSchemaV1.InferOutput<typeof updateRequestSchema>;
