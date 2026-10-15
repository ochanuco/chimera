import { z } from 'zod';
import { baseParametersIssues, overridesIssues } from '../lib/experiment-rules';
import { isHttpUrl } from '../lib/url-rules';
import { addIssues } from './issues';

/** overrides/evaluation/decision/promoted_overrides は typed schema を持たない JSON blob として受ける
 * (docs/domain-model.md)。評価軸は Experiment/評価者ごとに変わるため、固定すると都度 migration が必要になる。 */
export const jsonObject = z.record(z.string(), z.unknown());

/** MCP の入力 (create_experiment の arm / derive_request) が受ける patches。object 型で書くのは、必須キーを
 * tools/list の JSON Schema に `required` として載せ、enqueue 前に弾くため。語彙はここでは検証しない (作成時の文法検査は lib/patch-grammar.ts)。 */
export const patchesSchema = z.array(
  z.object({ target: z.string().min(1), op: z.string().min(1), reason: z.string().min(1) }).passthrough(),
);

/** overrides/promoted_overrides のエンベロープ検証。保証するのは「diff の形をしているか」だけで、patch の語彙
 * (target/op/value 等) は見ない。Run 作成時の文法検査は lib/patch-grammar.ts (docs/experiment-agent.md)。
 * evaluation/decision はここを通さない（自由記述のまま）。 */
export const overridesSchema = jsonObject.superRefine((value, ctx) => addIssues(ctx, overridesIssues(value)));

export const experimentStatusSchema = z.enum(['active', 'stabilized', 'promoted', 'abandoned']);
export const promotionStatusSchema = z.enum(['proposed', 'applied', 'rejected']);

/** `javascript:` などの実行可能スキームが `<a href>` に入らないよう、保存時点で弾く。 */
const httpUrl = z.string().refine(isHttpUrl, { message: 'must be an http(s) URL' });

/** base_parameters は語彙を解釈しない JSON blob だが、`seeds` だけは Run の request.seeds になる契約値なので形を検証する。
 * seeds があるとき request.count は seeds.length で決まるため、食い違う `count` は受け付けない。 */
export const baseParametersSchema = jsonObject.superRefine((value, ctx) => addIssues(ctx, baseParametersIssues(value)));

export const createExperimentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  note: z.string().optional(),
  base_recipe: z.string().optional(),
  base_parameters: baseParametersSchema.optional(),
  base_generation_id: z.string().min(1).optional(),
  character_id: z.string().min(1).optional(),
});

export const updateExperimentSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    base_recipe: z.string().nullable().optional(),
    base_parameters: baseParametersSchema.nullable().optional(),
    base_generation_id: z.string().min(1).nullable().optional(),
    character_id: z.string().min(1).nullable().optional(),
    status: experimentStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

/** Run に付記する自由記述の factor マップ。render_facts から読み取れない要因を人間/Agent が書き添えるもので、
 * overrides と違い generation 付与後も編集できる（docs/domain-model.md）。値を string|number に絞ることで
 * ネスト/配列/真偽値/null は zod が自動的に弾く。 */
export const runVariablesSchema = z.record(z.string().min(1), z.union([z.string(), z.number()]));

const BATCH_ID_REMOVED = 'batch_id is no longer supported; runs link to requests via run_id';

/** Batch 廃止後も batch_id を送ってくる呼び出しは、黙って無視せず 400 にする。 */
const removedBatchId = z.unknown().refine(() => false, { message: BATCH_ID_REMOVED }).optional();

export const createExperimentRunSchema = z.object({
  overrides: overridesSchema.optional(),
  objective: z.string().optional(),
  parent_run_id: z.string().min(1).optional(),
  batch_id: removedBatchId,
  generation_id: z.string().min(1).optional(),
  evaluation: jsonObject.optional(),
  decision: jsonObject.optional(),
  note: z.string().optional(),
  idempotency_key: z.string().min(1).optional(),
  variables: runVariablesSchema.optional(),
});

/** `generation_id` は attach 専用（nullable ではない）。付け替えると Run が「何を生んだ試行か」の
 * 記録でなくなるため 409 で拒否する。evaluation/decision は上書き・クリア可能。 */
export const updateExperimentRunSchema = z
  .object({
    overrides: overridesSchema.optional(),
    objective: z.string().nullable().optional(),
    batch_id: removedBatchId,
    generation_id: z.string().min(1).optional(),
    evaluation: jsonObject.nullable().optional(),
    decision: jsonObject.nullable().optional(),
    note: z.string().nullable().optional(),
    variables: runVariablesSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });

export const judgmentVerdictSchema = z.enum(['left', 'right', 'tie']);

export const createJudgmentSchema = z.object({
  baseline_run_id: z.string().min(1),
  arm_run_id: z.string().min(1),
  seed: z.number().int(),
  left_generation_id: z.string().min(1),
  right_generation_id: z.string().min(1),
  verdict: judgmentVerdictSchema,
});

export const createPromotionSchema = z.object({
  source_run_id: z.string().min(1).optional(),
  promoted_overrides: overridesSchema.optional(),
  target_repository: z.string().min(1).default('chagama'),
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
