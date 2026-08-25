import { z } from 'zod';

export const createStorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const updateStorySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const createStoryRelationSchema = z.object({
  source_batch_id: z.string().min(1),
  target_batch_id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  raw_instruction: z.string().optional(),
  generated_by: z.string().optional(),
});

export const updateStoryRelationSchema = z
  .object({
    label: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
