import { z } from 'zod';
import type { StandardSchemaV1 } from '../lib/standard-schema';

/** PUT が検証するのは封筒だけで、語彙 (pose/costume/expression など) は chagama のもの。chimera は保存して再公開する。`patches` の文法だけは Request / Run の作成時に lib/patch-grammar.ts が読む (docs/api.md「Recipe Catalog」)。 */
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

/** カタログ `patches` のうち chimera が読む部分の形。set 型の class (number / string / loras ...) は余分なキーとして残し、lib/patch-grammar.ts が走査する。 */
export const patchGrammarBlockSchema = z.looseObject({
  keys: z.array(z.string()),
  text: z.looseObject({
    targets: z.array(z.string()).optional(),
    part_target: z.string().optional(),
    ops: z.record(z.string(), z.array(z.string())),
  }),
});
