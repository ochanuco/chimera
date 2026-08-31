import { z } from 'zod';

/**
 * overrides / evaluation / decision / promoted_overrides は typed schema を持たない
 * JSON blob として受ける（docs/domain-model.md 参照）。評価軸は Experiment や
 * 評価者ごとに変わるため、ここで固定するとその都度 migration が必要になる。
 */
const jsonObject = z.record(z.string(), z.unknown());

export const experimentStatusSchema = z.enum(['active', 'stabilized', 'promoted', 'abandoned']);
export const promotionStatusSchema = z.enum(['proposed', 'applied', 'rejected']);

export const createExperimentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  note: z.string().optional(),
  base_recipe: z.string().optional(),
  character_id: z.string().min(1).optional(),
});

export const updateExperimentSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    base_recipe: z.string().nullable().optional(),
    character_id: z.string().min(1).nullable().optional(),
    status: experimentStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const createExperimentRunSchema = z.object({
  overrides: jsonObject.optional(),
  objective: z.string().optional(),
  parent_run_id: z.string().min(1).optional(),
  batch_id: z.string().min(1).optional(),
  generation_id: z.string().min(1).optional(),
  evaluation: jsonObject.optional(),
  decision: jsonObject.optional(),
  note: z.string().optional(),
});

/**
 * `batch_id` / `generation_id` は attach 専用（nullable ではない）。一度結び付いた
 * 生成結果を付け替えると Run が「何を生んだ試行か」の記録でなくなるため、
 * 付け替えは 409 で拒否する。evaluation / decision は上書き・クリア可能。
 */
export const updateExperimentRunSchema = z
  .object({
    overrides: jsonObject.optional(),
    objective: z.string().nullable().optional(),
    batch_id: z.string().min(1).optional(),
    generation_id: z.string().min(1).optional(),
    evaluation: jsonObject.nullable().optional(),
    decision: jsonObject.nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const createPromotionSchema = z.object({
  source_run_id: z.string().min(1).optional(),
  promoted_overrides: jsonObject.optional(),
  target_repository: z.string().min(1).default('comfyui-recipes'),
  target_path: z.string().optional(),
  commit_sha: z.string().optional(),
  pull_request_url: z.string().optional(),
  note: z.string().optional(),
});

export const updatePromotionSchema = z
  .object({
    status: promotionStatusSchema.optional(),
    promoted_overrides: jsonObject.optional(),
    target_repository: z.string().min(1).optional(),
    target_path: z.string().nullable().optional(),
    commit_sha: z.string().nullable().optional(),
    pull_request_url: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
