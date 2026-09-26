import { z } from 'zod';
import { RECIPE_REF_RE, finalizeOptionsSchema } from './requests';

export const presetKindSchema = z.enum(['pose', 'costume', 'expression', 'finalize']);

export const presetImportRequestSchema = z.object({
  recipe_ref: z.string().regex(RECIPE_REF_RE),
});

export const presetPromoteRequestSchema = z.object({
  generation_id: z.string().min(1),
  name: z.string().min(1),
  kind: presetKindSchema.default('pose'),
  base_version: z.number().int().positive().optional(),
  note: z.string().optional(),
  idempotency_key: z.string().min(1),
});

/** import 由来の行は本文を持たず、poses.py への名前参照だけ (docs/domain-model.md「Preset」)。本文の組み立ては worker の graph compiler が行う。
 * .strict() は import/promote 由来を取り違えず区別するため。 */
const presetBodyImportSchema = z.object({ recipe_pose: z.string().min(1) }).strict();

const presetBodyPromoteSchema = z
  .object({
    base: z.object({
      recipe: z.string(),
      kind: presetKindSchema,
      name: z.string(),
      version: z.number().int().positive(),
    }),
    patches: z.array(z.unknown()),
  })
  .strict();

/** kind `finalize` の本文は `finalizeOptionsSchema` そのもの (docs/domain-model.md「Preset」)。base 参照も patches も持たず、
 * 各版は全文上書きでチェーンを作らない。 */
export const presetBodyFinalizeSchema = z.object({ options: finalizeOptionsSchema }).strict();

export const presetBodySchema = z.union([presetBodyImportSchema, presetBodyPromoteSchema, presetBodyFinalizeSchema]);

export type PresetBody = z.infer<typeof presetBodySchema>;

export const presetPromoteProfileRequestSchema = z.object({
  generation_id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().optional(),
  idempotency_key: z.string().min(1),
});
