import { z } from 'zod';

const prob = z.number().min(0).max(1);

export const putSafetySchema = z.object({
  model: z.string().min(1),
  rating: z.object({
    general: prob,
    sensitive: prob,
    questionable: prob,
    explicit: prob,
  }),
  tags: z.record(z.string().min(1), prob),
});
