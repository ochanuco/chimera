import { z } from 'zod';

/** https:// 限定。投稿先(X)のURL以外を書く事故を防ぐための最低限のチェック。 */
export const publicationUrlSchema = z
  .string()
  .refine((v) => v.startsWith('https://'), { message: 'url must be an https:// URL' })
  .refine(
    (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'url must be a valid URL' },
  );

export const createPublicationSchema = z.object({
  url: publicationUrlSchema.nullable().optional(),
  published_at: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
});

export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

export const updatePublicationSchema = z.object({
  url: publicationUrlSchema.nullable(),
});
