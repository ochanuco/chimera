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
  references: z.array(referenceInputSchema).optional(),
  refinement: refinementInputSchema.optional(),
  story: storyInputSchema.optional(),
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
