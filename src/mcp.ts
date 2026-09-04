// chimera ドメインへの MCP インターフェース。docs/experiment-agent.md 参照。
//
// tool のハンドラは REST routes (src/routes/experiments.ts) と同じ
// src/lib/experiments.ts の関数を呼ぶ。クエリ・guardrails (404/409) を
// 二重に持たないため。ApiError はここで握りつぶさずそのまま投げる:
// McpServer の tools/call ハンドラが catch して
// `{ content: [{ type: 'text', text: error.message }], isError: true }`
// に変換する（node_modules/@modelcontextprotocol/server の実装、
// createToolError を参照）ので、メッセージはそのまま tool error に出る。

// 読み取り tool には readOnlyHint を付ける。Cloudflare OS の gatekeeper-mcp は
// annotation のない tool をすべて副作用ありの action として承認キューに入れ、
// 呼び出し時点では結果を返さない。読み取りがそこに入ると Agent はデータを
// 受け取れず同じ呼び出しを繰り返す。
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createExperimentRunSchema, experimentStatusSchema, jsonObject } from './schemas/experiments';
import { notFound } from './lib/errors';
import {
  createExperimentRun,
  getExperimentDetail,
  getExperimentOr404,
  getRunOr404,
  getRunWithExperimentContext,
  latestRunByExperiment,
  listGenerationsLightForBatch,
  queryExperiments,
  resolveGenerationOr404,
  updateExperimentRun,
  evaluationOverall,
} from './lib/experiments';
import { canonicalGenerationUrl, serializeExperimentRun } from './lib/serialize';
import { parseJsonObjectOrNull } from './lib/overrides';
import type { Bindings } from './types';

/**
 * MCP クライアント（cloudflare-os の packages/mcp-shared/src/fetch.ts、MAX_RESPONSE_BYTES）は
 * tools/call レスポンス全体を 1 MiB で切る。inline image は base64 化で 4/3 に膨れるため、
 * 実際に返せる生バイト数は 1 MiB ÷ (4/3) ≈ 786 KiB。JSON-RPC envelope の分の余裕を見て
 * 700 KiB に切り詰める。
 */
const MAX_RETURNED_IMAGE_BYTES = 700 * 1024;

/** Images binding の `.input()` はここを超えると ImagesError を投げるので、その前に text で断る。 */
const MAX_TRANSFORM_INPUT_BYTES = 20 * 1024 * 1024;

const DEFAULT_IMAGE_WIDTH = 768;
const MIN_IMAGE_WIDTH = 256;
const MAX_IMAGE_WIDTH = 1024;

function clampImageWidth(width: number | undefined): number {
  if (width === undefined) return DEFAULT_IMAGE_WIDTH;
  return Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(width)));
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * Uint8Array -> base64。`btoa(String.fromCharCode(...bytes))` は引数展開が
 * 呼び出しスタック上限に当たるため、chunk に分けて畳み込む。
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const createRunInputSchema = createExperimentRunSchema
  .pick({ overrides: true, objective: true, parent_run_id: true, idempotency_key: true, variables: true })
  .extend({ experiment_id: z.string().min(1) });

export function createChimeraMcpServer(env: Bindings, origin: string): McpServer {
  const db = env.DB;
  const bucket = env.IMAGES;
  const server = new McpServer({ name: 'chimera', version: '1.0.0' });

  server.registerTool(
    'list_experiments',
    {
      description: 'List Experiments, optionally filtered by status. Each item carries its base_recipe/base_parameters and latest Run.',
      inputSchema: z.object({ status: experimentStatusSchema.optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => {
      const rows = await queryExperiments(db, { status }, 200, 0);
      const latestRuns = await latestRunByExperiment(db, rows.map((r) => r.id));
      const items = rows.map((r) => {
        const latest = latestRuns.get(r.id);
        return {
          id: r.id,
          short_id: r.short_id,
          name: r.name,
          status: r.status,
          base_recipe: r.base_recipe,
          base_parameters: parseJsonObjectOrNull(r.base_parameters_json),
          run_count: r.run_count,
          latest_run: latest
            ? {
                id: latest.id,
                run_index: latest.run_index,
                created_at: latest.created_at,
                evaluation_overall: evaluationOverall(latest),
              }
            : null,
        };
      });
      return jsonResult({ items });
    },
  );

  server.registerTool(
    'get_experiment',
    {
      description: 'Get an Experiment (by id or short_id) with its runs, promotions and tags — same shape as GET /api/v1/experiments/{id}.',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const experiment = await getExperimentOr404(db, id);
      return jsonResult(await getExperimentDetail(db, experiment, origin));
    },
  );

  server.registerTool(
    'create_run',
    {
      description:
        'Create a new Run under an Experiment with the given overrides. The Run starts unexecuted (no batch attached). ' +
        'overrides is a diff against the Experiment\'s base recipe, shaped {"patches": [...]}. Each patch is ' +
        '{target, op, reason, plus value and/or old depending on op} — reason is required on every patch. ' +
        "chimera does not define the target/op vocabulary; it's the recipe's, on the comfyui-recipes side — read " +
        'existing Runs\' overrides (list_experiments / get_experiment / get_run) to learn what is in use. ' +
        'Generation parameters such as pose or costume are NOT overrides — they live in the Experiment\'s ' +
        'base_parameters and are fixed for the whole Experiment. ' +
        'Pass a stable idempotency_key (e.g. one generated per intended Run) so that if the response is lost, retrying ' +
        'with the same key returns the original Run instead of creating a duplicate — Runs cannot be deleted, so a duplicate is permanent. ' +
        'variables: optional flat map of factor names to values that the graph cannot express, e.g. {"prompt_variant": "socks-v2"}; ' +
        'shown as extra columns in the Experiment facts table.',
      inputSchema: createRunInputSchema,
    },
    async ({ experiment_id, overrides, objective, parent_run_id, idempotency_key, variables }) => {
      const experiment = await getExperimentOr404(db, experiment_id);
      const { row, created } = await createExperimentRun(db, experiment, {
        overrides,
        objective,
        parent_run_id,
        idempotency_key,
        variables,
      });
      return jsonResult({ created, run: serializeExperimentRun(row) });
    },
  );

  server.registerTool(
    'get_run',
    {
      description: "Get a Run, its attached batch, and that batch's generations (short_id, rating, image dimensions).",
      inputSchema: z.object({ run_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ run_id }) => {
      const run = await getRunOr404(db, run_id);
      const { decorated, experiment } = await getRunWithExperimentContext(db, run, origin);
      const generations = run.batch_id ? await listGenerationsLightForBatch(db, run.batch_id, origin) : [];
      return jsonResult({
        ...decorated,
        experiment: {
          id: experiment.id,
          short_id: experiment.short_id,
          name: experiment.name,
          status: experiment.status,
          base_recipe: experiment.base_recipe,
          character_id: experiment.character_id,
        },
        generations,
      });
    },
  );

  server.registerTool(
    'get_generation_image',
    {
      description:
        'Fetch a Generation image by short_id (or id). Returns it downscaled and re-encoded as JPEG — the MCP ' +
        "client caps a whole response at 1MB, which a full-size PNG blows past once base64-encoded — so it's for " +
        'judging composition, not pixel-level inspection. width (256-1024, default 768) trades detail for a ' +
        'smaller reply. Images too large to inline return the canonical URL instead.',
      inputSchema: z.object({ short_id: z.string().min(1), width: z.number().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ short_id, width }) => {
      const generation = await resolveGenerationOr404(db, short_id);
      const head = await bucket.head(generation.r2_object_key);
      if (!head) throw notFound('image');

      const canonicalUrl = canonicalGenerationUrl(origin, generation.short_id);
      const pointer = (reason: string) => ({
        content: [{ type: 'text' as const, text: `${reason} See ${canonicalUrl}` }],
      });

      if (head.size > MAX_TRANSFORM_INPUT_BYTES) {
        return pointer(`image is ${head.size} bytes, over the ${MAX_TRANSFORM_INPUT_BYTES} byte transform input limit.`);
      }

      const object = await bucket.get(generation.r2_object_key);
      if (!object) throw notFound('image');

      // transform 用と、失敗時のフォールバック用に body を分ける。成功すれば
      // フォールバック側は誰も読まないまま捨てられる。
      const [forTransform, forFallback] = object.body.tee();

      let bytes: Uint8Array;
      let mimeType: string;
      try {
        const result = await env.IMAGE_TRANSFORM.input(forTransform)
          .transform({ width: clampImageWidth(width) })
          .output({ format: 'image/jpeg', quality: 72 });
        bytes = new Uint8Array(await result.response().arrayBuffer());
        mimeType = 'image/jpeg';
      } catch {
        // 変換失敗（壊れた画像、binding 未提供の環境など）でも tool call 自体は
        // 失敗させない。元画像がキャップ内に収まればそのまま返し、収まらなければ
        // 従来どおりポインタに落とす。
        bytes = new Uint8Array(await new Response(forFallback).arrayBuffer());
        mimeType = object.httpMetadata?.contentType ?? 'image/png';
      }

      if (bytes.length > MAX_RETURNED_IMAGE_BYTES) {
        return pointer(`image is ${bytes.length} bytes, over the ${MAX_RETURNED_IMAGE_BYTES} byte inline limit.`);
      }

      return {
        content: [{ type: 'image' as const, data: toBase64(bytes), mimeType }],
      };
    },
  );

  server.registerTool(
    'attach_generation',
    {
      description:
        'Attach a Generation (the representative result) to a Run. The Run must already have a Batch attached, and the Generation must belong to that Batch. 409s if the Run already has a different Generation attached, if no Batch is attached yet, or if the Generation belongs to a different Batch.',
      inputSchema: z.object({ run_id: z.string().min(1), generation_id: z.string().min(1) }),
    },
    async ({ run_id, generation_id }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { generation_id });
      return jsonResult(serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_evaluation',
    {
      description: 'Set (or clear with null) a Run’s evaluation. Arbitrary JSON object; chimera does not validate its shape.',
      inputSchema: z.object({ run_id: z.string().min(1), evaluation: jsonObject.nullable() }),
    },
    async ({ run_id, evaluation }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { evaluation });
      return jsonResult(serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_decision',
    {
      description: 'Set (or clear with null) a Run’s decision. Arbitrary JSON object; chimera does not validate its shape.',
      inputSchema: z.object({ run_id: z.string().min(1), decision: jsonObject.nullable() }),
    },
    async ({ run_id, decision }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { decision });
      return jsonResult(serializeExperimentRun(updated));
    },
  );

  return server;
}
