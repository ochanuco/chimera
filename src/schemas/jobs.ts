import { z } from 'zod';

export const createJobSchema = z.object({
  idempotency_key: z.string().min(1),
  seed: z.number().int(),
  index: z.number().int().nonnegative(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = z
  .object({
    status: z
      .enum(['created', 'queued', 'running', 'completed', 'ingested', 'failed'])
      .optional(),
    comfy_prompt_id: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export type UpdateJobInput = z.infer<typeof updateJobSchema>;

export const ingestMetadataSchema = z.object({
  seed: z.number().int(),
  original_filename: z.string().min(1),
  comfy_output_index: z.number().int().nonnegative(),
  character_id: z.string().min(1).optional(),
});

export type IngestMetadataInput = z.infer<typeof ingestMetadataSchema>;
