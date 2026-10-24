import { z } from 'zod';

/**
 * `pose` 省略は pin 済みの全 pose、指定はその 1 つだけ描き直す。`angle` / `framing` はどちらか 1 つだけで、
 * recipe 既定にその 1 語を足した variant を描く。
 */
export const styleCheckRenderSchema = z
  .object({
    pose: z.string().min(1).optional(),
    angle: z.string().min(1).optional(),
    framing: z.string().min(1).optional(),
  })
  .refine((body) => !(body.angle && body.framing), { message: 'pass angle or framing, not both' });
