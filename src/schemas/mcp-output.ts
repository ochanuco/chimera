// MCP tool の outputSchema。ChatGPT のような client は outputSchema を持たない tool の
// 結果を「型の分からない JSON テキスト」としてしか扱えず、開発者モードで
// 「出力スキーマ推奨」の警告になる。
//
// SDK は structuredContent をこの schema で検証し、通らなければ tool call ごと
// ProtocolError にする（@modelcontextprotocol/server の validateToolOutput）。つまり
// ここを厳しく書くと、serializer に欄が1つ増えただけで本番の tool call が落ちる。
// なので:
//   - すべて looseObject（未知のキーを許す）
//   - 深い所（payload / graph / semantic / catalog record など）は unknown のまま渡す
//   - 実在を確かめていない欄は optional
// 目的は形の宣言であって、契約の二重定義ではない。正本は各 serializer。

import { z } from 'zod';

const jsonObject = z.record(z.string(), z.unknown());
const jsonObjectOrNull = jsonObject.nullable();

/** serializeExperimentRun (lib/serialize.ts)。 */
const runSchema = z.looseObject({
  id: z.string(),
  experiment_id: z.string(),
  run_index: z.number(),
  parent_run_id: z.string().nullable(),
  batch_id: z.string().nullable(),
  generation_id: z.string().nullable(),
  overrides: jsonObject,
  objective: z.string().nullable(),
  evaluation: jsonObjectOrNull,
  decision: jsonObjectOrNull,
  note: z.string().nullable(),
  variables: jsonObjectOrNull,
  created_at: z.string(),
  updated_at: z.string(),
});

/** serializeGenerationLight (lib/serialize.ts)。 */
const generationLightSchema = z.looseObject({
  id: z.string(),
  short_id: z.string(),
  canonical_url: z.string(),
  image_url: z.string(),
  rating: z.string().nullable(),
  bookmark: z.boolean(),
  character_id: z.string().nullable(),
  created_at: z.string(),
  image_width: z.number().nullable(),
  image_height: z.number().nullable(),
});

/** decorateRuns (lib/experiments.ts) — Run に batch / generation / render_facts を足したもの。 */
const decoratedRunSchema = runSchema.extend({
  batch: z.looseObject({ id: z.string(), short_id: z.string(), thumbnail_url: z.string().nullable() }).nullable(),
  generation: generationLightSchema.nullable(),
  render_facts: z.unknown().optional(),
});

/** serializeRequest (lib/serialize.ts)。payload_hash は含まない。 */
const requestSchema = z.looseObject({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  payload: jsonObject,
  recipe_ref: z.string().nullable(),
  run_id: z.string().nullable(),
  worker_id: z.string().nullable(),
  attempt: z.number(),
  max_attempts: z.number(),
  claimed_at: z.string().nullable(),
  heartbeat_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
  result: z.unknown().optional(),
  idempotency_key: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const createdRequestSchema = z.looseObject({ created: z.boolean(), request: requestSchema });

/** summarizePreset (lib/presets.ts)。 */
const presetSummarySchema = z.looseObject({
  id: z.string(),
  recipe: z.string(),
  kind: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.string(),
  source: z.string(),
  source_generation_id: z.string().nullable(),
  base_fingerprint: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
});

/** serializeResolvedPreset — summary に base 連鎖を畳んだ record / patches を足したもの。 */
const resolvedPresetSchema = presetSummarySchema.extend({
  record: z.unknown(),
  patches: z.array(z.unknown()),
});

/** serializeObservation (lib/observations.ts)。 */
const observationSchema = z.looseObject({
  id: z.string(),
  character: z.string(),
  pose: z.string().nullable(),
  component: z.string().nullable(),
  parameter: z.string(),
  value: z.string(),
  outcome: z.string(),
  reason: z.string(),
  seed: z.number().nullable(),
  render_id: z.string().nullable(),
  generation_ids: z.array(z.string()).nullable(),
  recipe: z.string().nullable(),
  observed_at: z.string().nullable(),
  supersedes_id: z.string().nullable(),
  source: z.string(),
  created_at: z.string(),
});

export const mcpOutputSchemas = {
  list_experiments: z.looseObject({
    items: z.array(
      z.looseObject({
        id: z.string(),
        short_id: z.string(),
        name: z.string(),
        status: z.string(),
        base_recipe: z.string().nullable(),
        base_parameters: jsonObjectOrNull,
        base_generation_id: z.string().nullable(),
        run_count: z.number(),
        latest_run: z
          .looseObject({
            id: z.string(),
            run_index: z.number(),
            created_at: z.string(),
            evaluation_overall: z.string().nullable(),
          })
          .nullable(),
      }),
    ),
  }),

  get_experiment: z.looseObject({
    id: z.string(),
    short_id: z.string(),
    name: z.string(),
    status: z.string(),
    base_recipe: z.string().nullable(),
    base_parameters: jsonObjectOrNull,
    character: z.looseObject({ id: z.string(), name: z.string() }).nullable(),
    tags: z.array(z.string()),
    run_count: z.number(),
    runs: z.array(decoratedRunSchema),
    promotions: z.array(z.looseObject({ id: z.string(), source_run_id: z.string(), status: z.string() })),
  }),

  create_run: z.looseObject({
    created: z.boolean(),
    run: runSchema.extend({ request_id: z.string().nullable().optional() }),
  }),

  get_run: decoratedRunSchema.extend({
    experiment: z.looseObject({
      id: z.string(),
      short_id: z.string(),
      name: z.string(),
      status: z.string(),
      base_recipe: z.string().nullable(),
      base_generation_id: z.string().nullable(),
      character_id: z.string().nullable(),
    }),
    generations: z.array(generationLightSchema),
  }),

  // 画像そのものは content の image ブロックで返る。structuredContent 側は
  // 「返せたのか、なぜ返せなかったのか」だけを持つ。
  get_generation_image: z.looseObject({
    short_id: z.string(),
    canonical_url: z.string(),
    inlined: z.boolean(),
    mime_type: z.string().nullable(),
    reason: z.string().nullable(),
  }),

  attach_generation: runSchema,
  set_evaluation: runSchema,
  set_decision: runSchema,

  create_request: createdRequestSchema,
  finalize_generation: createdRequestSchema,
  repair_generation: createdRequestSchema,
  masked_redraw_generation: createdRequestSchema,
  get_request: requestSchema,
  list_requests: z.looseObject({ items: z.array(requestSchema) }),

  list_generations: z.looseObject({
    items: z.array(
      z.looseObject({
        short_id: z.string(),
        rating: z.string().nullable(),
        bookmark: z.boolean(),
        tags: z.array(z.string()),
        summary: z.string().nullable(),
        character: z.string().nullable(),
        created_at: z.string(),
        batch_id: z.string().nullable(),
        canonical_url: z.string(),
      }),
    ),
    total: z.number(),
  }),

  get_generation: z.looseObject({
    id: z.string().optional(),
    short_id: z.string().optional(),
    rating: z.string().nullable().optional(),
    bookmark: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    semantic: z.unknown().optional(),
    batch: z.unknown().optional(),
    comfy_job: z.unknown().optional(),
    references: z.unknown().optional(),
    original_filename: z.string().nullable().optional(),
  }),

  list_batch: z.looseObject({
    id: z.string().optional(),
    short_id: z.string().optional(),
    recipe: z.string().nullable().optional(),
    prompt: z.string().nullable().optional(),
    negative_prompt: z.string().nullable().optional(),
    parameters: z.unknown().optional(),
    patches: z.unknown().optional(),
    preset_versions: z.unknown().optional(),
    jobs: z.array(z.unknown()).optional(),
    generations: z.array(z.unknown()).optional(),
    references: z.unknown().optional(),
    relations: z.unknown().optional(),
    experiment_run: z.unknown().optional(),
  }),

  get_generation_lineage: z.looseObject({
    generation: z.unknown().optional(),
    batch: z.unknown().optional(),
    ancestors: z.array(z.unknown()).optional(),
    descendants: z.array(z.unknown()).optional(),
  }),

  derive_request: z.looseObject({
    created: z.boolean(),
    request: requestSchema,
    payload: jsonObject,
    derived_from: z.looseObject({
      requested: z.looseObject({ id: z.string(), short_id: z.string() }),
      source: z.looseObject({ id: z.string(), short_id: z.string() }),
    }),
  }),

  list_catalog: z.looseObject({
    recipe_ref: z.string(),
    published_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    recipes: z.array(z.unknown()).optional(),
    patches: z.unknown().optional(),
    git_commit: z.string().nullable().optional(),
    git_branch: z.string().nullable().optional(),
  }),

  // catalog の pose record は comfyui-recipes 側の形。chimera は中身を定義しない。
  get_catalog_pose: z.looseObject({ name: z.string().optional() }),

  list_presets: z.looseObject({ items: z.array(presetSummarySchema) }),
  get_preset: resolvedPresetSchema,
  promote_to_pose: resolvedPresetSchema,

  list_observations: z.looseObject({ items: z.array(observationSchema), total: z.number() }),
  get_observation: observationSchema,
  record_observation: observationSchema,
} as const;
