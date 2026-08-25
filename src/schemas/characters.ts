import { z } from 'zod';

export const createCharacterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
});
