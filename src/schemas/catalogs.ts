import { z } from 'zod';

/**
 * Envelope-only validation. Vocabulary (what a "pose"/"costume"/"expression" carries,
 * per-recipe `parameters`, `patches` shapes) belongs to comfyui-recipes — chimera stores
 * and republishes it without interpreting it (docs/api.md「Recipe Catalog」).
 */
export const recipeCatalogEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    recipes: z.array(z.object({ name: z.string(), poses: z.array(z.unknown()) }).passthrough()),
    patches: z.record(z.string(), z.unknown()),
    git_commit: z.string().nullable().optional(),
    git_branch: z.string().nullable().optional(),
    generated_at: z.string().nullable().optional(),
  })
  .passthrough();

export type RecipeCatalogDoc = z.infer<typeof recipeCatalogEnvelopeSchema>;
