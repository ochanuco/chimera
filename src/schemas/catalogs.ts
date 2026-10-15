import { z } from 'zod';
import type { StandardSchemaV1 } from '../lib/standard-schema';

/** Envelope-only: vocabulary (pose/costume/expression, patches shapes) belongs to chagama; chimera stores and republishes without interpreting it (docs/api.md「Recipe Catalog」). */
export const recipeCatalogEnvelopeSchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    recipes: z.array(z.object({ name: z.string(), poses: z.array(z.unknown()) }).passthrough()),
    patches: z.record(z.string(), z.unknown()),
    git_commit: z.string().nullable().optional(),
    git_branch: z.string().nullable().optional(),
    generated_at: z.string().nullable().optional(),
  })
  .passthrough();

export type RecipeCatalogDoc = StandardSchemaV1.InferOutput<typeof recipeCatalogEnvelopeSchema>;
