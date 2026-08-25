import { z } from 'zod';

export const semanticCoreSchema = z.object({
  pose: z.string().nullable().optional(),
  expression: z.string().nullable().optional(),
  outfit: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  composition: z.string().nullable().optional(),
});

export const semanticUpdateSchema = z.object({
  schema_version: z.number().int(),
  summary: z.string().optional(),
  core: semanticCoreSchema.optional(),
  strengths: z.array(z.string()).optional(),
  defects: z.array(z.string()).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  generated_by: z
    .object({
      provider: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

export type SemanticUpdateInput = z.infer<typeof semanticUpdateSchema>;

export const ratingUpdateSchema = z.object({
  rating: z.enum(['bad', 'neutral', 'good']).nullable(),
});

export const updateGenerationSchema = z
  .object({
    note: z.string().nullable().optional(),
    character_id: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
