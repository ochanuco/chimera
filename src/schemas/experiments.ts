import { z } from 'zod';

/**
 * overrides / evaluation / decision / promoted_overrides は typed schema を持たない
 * JSON blob として受ける（docs/domain-model.md 参照）。評価軸は Experiment や
 * 評価者ごとに変わるため、ここで固定するとその都度 migration が必要になる。
 */
export const jsonObject = z.record(z.string(), z.unknown());

/**
 * overrides / promoted_overrides のエンベロープ検証。patch の語彙 (target / op の値、
 * value・old の型) は comfyui-recipes 側の実装に属するため検証しない。chimera が
 * 保証するのは「diff の形をしているか」だけ — base_parameters 相当の生成パラメータが
 * overrides に紛れ込む事故 (docs/experiment-agent.md 参照) を型では防げないので、
 * せめて封筒の形だけ弾く。evaluation / decision はここを通さない（自由記述のまま）。
 */
export const overridesSchema = jsonObject.superRefine((value, ctx) => {
  const keys = Object.keys(value);
  const unexpected = keys.filter((k) => k !== 'patches');
  if (unexpected.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message:
        `must be {} or {"patches": [...]}; unexpected key(s): ${unexpected.join(', ')}. ` +
        "Generation parameters (pose, costume, count, ...) belong to the Experiment's base_parameters, not to a Run's overrides.",
    });
    return;
  }
  if (!('patches' in value)) return;

  const patches = value.patches;
  if (!Array.isArray(patches)) {
    ctx.addIssue({
      code: 'custom',
      message: 'must be an array of patch objects, e.g. [{ target, op, reason, value? }]',
      path: ['patches'],
    });
    return;
  }
  patches.forEach((patch, i) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      ctx.addIssue({
        code: 'custom',
        message: 'each patch must be an object with target, op and reason',
        path: ['patches', i],
      });
      return;
    }
    for (const field of ['target', 'op', 'reason'] as const) {
      const fieldValue = (patch as Record<string, unknown>)[field];
      if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'must be a non-empty string', path: ['patches', i, field] });
      }
    }
  });
});

export const experimentStatusSchema = z.enum(['active', 'stabilized', 'promoted', 'abandoned']);
export const promotionStatusSchema = z.enum(['proposed', 'applied', 'rejected']);

/** `javascript:` などの実行可能スキームが `<a href>` に入らないよう、保存時点で弾く。 */
const httpUrl = z.string().refine(
  (v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an http(s) URL' },
);

export const createExperimentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  note: z.string().optional(),
  base_recipe: z.string().optional(),
  base_parameters: jsonObject.optional(),
  character_id: z.string().min(1).optional(),
});

export const updateExperimentSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    base_recipe: z.string().nullable().optional(),
    base_parameters: jsonObject.nullable().optional(),
    character_id: z.string().min(1).nullable().optional(),
    status: experimentStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const createExperimentRunSchema = z.object({
  overrides: overridesSchema.optional(),
  objective: z.string().optional(),
  parent_run_id: z.string().min(1).optional(),
  batch_id: z.string().min(1).optional(),
  generation_id: z.string().min(1).optional(),
  evaluation: jsonObject.optional(),
  decision: jsonObject.optional(),
  note: z.string().optional(),
  idempotency_key: z.string().min(1).optional(),
});

/**
 * `batch_id` / `generation_id` は attach 専用（nullable ではない）。一度結び付いた
 * 生成結果を付け替えると Run が「何を生んだ試行か」の記録でなくなるため、
 * 付け替えは 409 で拒否する。evaluation / decision は上書き・クリア可能。
 */
export const updateExperimentRunSchema = z
  .object({
    overrides: overridesSchema.optional(),
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
  promoted_overrides: overridesSchema.optional(),
  target_repository: z.string().min(1).default('comfyui-recipes'),
  target_path: z.string().optional(),
  commit_sha: z.string().optional(),
  pull_request_url: httpUrl.optional(),
  note: z.string().optional(),
});

export const updatePromotionSchema = z
  .object({
    status: promotionStatusSchema.optional(),
    promoted_overrides: overridesSchema.optional(),
    target_repository: z.string().min(1).optional(),
    target_path: z.string().nullable().optional(),
    commit_sha: z.string().nullable().optional(),
    pull_request_url: httpUrl.nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
