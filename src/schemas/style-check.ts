import { z } from 'zod';

/** `pose` 省略は pin 済みの全 pose、指定はその 1 つだけ描き直す。 */
export const styleCheckRenderSchema = z.object({ pose: z.string().min(1).optional() });
