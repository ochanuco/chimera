import { z } from 'zod';

export const createExperimentSchema = z.object({
  name: z.string().min(1),
  note: z.string().optional(),
});

export const updateExperimentSchema = z
  .object({
    name: z.string().min(1).optional(),
    note: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
