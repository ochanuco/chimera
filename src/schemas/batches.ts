import { z } from 'zod';

export const referenceInputSchema = z.object({
  source_generation_id: z.string().min(1),
  purpose: z.string().min(1).optional(),
  aspect: z.string().min(1).optional(),
  instruction: z.string().optional(),
});

export const refinementInputSchema = z.object({
  source_batch_id: z.string().min(1),
  actor: z.enum(['human', 'claude']),
  reason: z.string().optional(),
  raw_instruction: z.string().optional(),
});

export const storyInputSchema = z.object({
  story_id: z.string().min(1),
  previous_batch_ids: z.array(z.string().min(1)).min(1),
  transition: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  raw_instruction: z.string().optional(),
});

export const createBatchSchema = z.object({
  idempotency_key: z.string().min(1),
  experiment_id: z.string().min(1).optional(),
  raw_instruction: z.string().optional(),
  recipe: z.string().optional(),
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  git_commit: z.string().optional(),
  git_dirty: z.boolean().optional(),
  // request.json (docs/generation-request.md) は「該当なし」を明示的な null で表す
  references: z.array(referenceInputSchema).nullish(),
  refinement: refinementInputSchema.nullish(),
  story: storyInputSchema.nullish(),
  // worker が実際に適用した patches とそのときの pose レコードの digest。promote は
  // これを正本として読む (semantic.attributes.patches は使わない、docs/domain-model.md
  // 「Preset」不変条件)。patch の語彙 (op/value 等) は検証しない — passthrough で
  // 素通しし、chimera が見るのは target/op/reason の封筒だけ (schemas/experiments.ts の
  // overridesSchema と同じ方針)。
  patches: z.array(
    z.object({ target: z.string().min(1), op: z.string().min(1), reason: z.string().min(1) }).passthrough(),
  ).optional(),
  pose_fingerprint: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  // patches があるのに fingerprint が無い Batch から昇格すると base_fingerprint が NULL に
  // なり、その preset だけ base の drift を検出できなくなる (docs/domain-model.md「Preset」
  // base が動くことへの備え)。昇格の材料になる Batch では両方を揃える。
  if ((value.patches?.length ?? 0) > 0 && !value.pose_fingerprint) {
    ctx.addIssue({ code: 'custom', message: 'pose_fingerprint is required when patches is non-empty', path: ['pose_fingerprint'] });
  }
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const updateBatchSchema = z
  .object({
    status: z.enum(['created', 'running', 'completed', 'partial', 'failed']).optional(),
    note: z.string().nullable().optional(),
    experiment_id: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;

export const createBatchReferenceSchema = referenceInputSchema;

export const createBatchRelationSchema = z.object({
  source_batch_id: z.string().min(1),
  type: z.string().optional(),
  actor: z.enum(['human', 'claude']),
  reason: z.string().optional(),
  raw_instruction: z.string().optional(),
});
