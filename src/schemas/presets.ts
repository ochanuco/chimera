import { z } from 'zod';
import { RECIPE_REF_RE } from './requests';

export const presetKindSchema = z.enum(['pose', 'costume', 'expression']);

export const presetImportRequestSchema = z.object({
  recipe_ref: z.string().regex(RECIPE_REF_RE),
});

/**
 * chimera は preset の器の形だけを知り、record の中身と patch の意味 (op の語彙) は
 * comfyui-recipes 側のものとして解釈しない (docs/domain-model.md「Preset」不変条件、
 * src/schemas/catalogs.ts と同じ方針)。.strict() は import 由来/promote 由来を
 * 取り違えず区別するためだけのもので、record/patches の中身までは検証しない。
 */
const presetBodyImportSchema = z.object({ record: z.unknown() }).strict();

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
