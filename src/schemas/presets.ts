import { z } from 'zod';
import { RECIPE_REF_RE } from './requests';

export const presetKindSchema = z.enum(['pose', 'costume', 'expression']);

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

/**
 * import 由来の行は pose の本文を持たず、comfyui-recipes 側の poses.py への名前参照
 * だけを持つ (docs/domain-model.md「Preset」body の形)。本文の組み立て (costume 依存の
 * 分岐) を chimera 側で行わないための境界で、解決するのは worker の graph compiler。
 * .strict() は import 由来/promote 由来を取り違えず区別するためだけのもの。
 */
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

export const presetBodySchema = z.union([presetBodyImportSchema, presetBodyPromoteSchema]);

export type PresetBody = z.infer<typeof presetBodySchema>;
