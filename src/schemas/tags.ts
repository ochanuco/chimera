import { z } from 'zod';

export const assignTagSchema = z.object({
  name: z.string().min(1),
  created_by: z.enum(['human', 'claude']).optional(),
});

export const renameTagSchema = z.object({
  name: z.string().min(1),
});
