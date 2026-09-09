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
import {
  requestKindSchema,
  requestStatusSchema,
  RECIPE_REF_RE,
  payloadEnvelopeIssues,
  finalizeOptionsSchema,
  repairOptionsSchema,
  maskedRedrawOptionsSchema,
} from './schemas/requests';
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
import {
  createRequest,
  getRequestOr404,
  listRequests,
  defaultRecipeRef,
  buildDerivedRequestPayload,
  resolveDerivationSource,
} from './lib/requests';
import { getGenerationDetail, queryGenerations } from './lib/generations';
import { getBatchDigest } from './lib/batches';
import { getGenerationLineage } from './lib/lineage';
import { getCatalog, summarizeCatalog, findCatalogPose } from './lib/catalogs';
import { presetKindSchema } from './schemas/presets';
import { getPresetRow, listPresets, resolvePreset, serializeResolvedPreset } from './lib/presets';
import { promoteGenerationToPreset } from './lib/promote';
import { getBatchByIdOrShortId } from './lib/db';
import { notifyHub, type Waitable } from './lib/hub-notify';
import { canonicalGenerationUrl, serializeExperimentRun, serializeRequest } from './lib/serialize';
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

/** Parses a stored JSON array column (`patches_json` / `preset_versions_json`); NULL や非配列は `[]`。 */
function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

/** REST の createRequestSchema と同じ封筒検証だが、`created_by` は tool 側で 'mcp' に固定するため受け取らない。 */
const createRequestInputSchema = z
  .object({
    kind: requestKindSchema,
    payload: jsonObject,
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
    idempotency_key: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    for (const issue of payloadEnvelopeIssues(value.kind, value.payload)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['payload', ...issue.path] });
    }
  });

/** `finalize_generation` の入力。options は finalizePayloadSchema と同じ語彙 (schemas/requests.ts) をそのまま流用する。 */
const finalizeGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: finalizeOptionsSchema.optional(),
  idempotency_key: z.string().min(1),
});

/** `repair_generation` の入力。options は repairPayloadSchema と同じ語彙 (schemas/requests.ts) をそのまま流用する。 */
const repairGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: repairOptionsSchema.optional(),
  idempotency_key: z.string().min(1),
});

/** `masked_redraw_generation` requires explicit regions and a prompt patch. */
const maskedRedrawGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: maskedRedrawOptionsSchema,
  idempotency_key: z.string().min(1),
});

/** `derive_request` の入力。count と seeds の対応は request.json v1 (docs/generation-request.md) の request.seeds が Job 数と一致する必要があるための整合チェック。 */
const deriveRequestInputSchema = z
  .object({
    from_generation_id: z.string().min(1),
    instruction: z.string().min(1),
    count: z.number().int().min(1).default(1),
    seeds: z.array(z.number().int()).optional(),
    parameters: jsonObject.optional(),
    patches: z.array(z.unknown()).optional(),
    replace_patches: z.boolean().default(false),
    semantic: z.object({ summary: z.string().min(1) }).passthrough(),
    reference: z.object({ aspect: z.string().optional(), instruction: z.string().optional() }).optional(),
    idempotency_key: z.string().min(1),
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.seeds && value.seeds.length !== value.count) {
      ctx.addIssue({
        code: 'custom',
        message: `seeds length (${value.seeds.length}) must equal count (${value.count})`,
        path: ['seeds'],
      });
    }
  });

const generationLineageInputSchema = z.object({
  generation_id: z.string().min(1),
  depth: z.number().int().min(0).max(10).optional(),
});

/** 1:1 with GET /api/v1/generations's filters (src/lib/generations.ts queryGenerations). */
const listGenerationsInputSchema = z.object({
  tag: z.string().min(1).optional(),
  rating: z.enum(['bad', 'neutral', 'good']).optional(),
  bookmark: z.boolean().optional(),
  character: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

const listCatalogInputSchema = z.object({ recipe_ref: z.string().regex(RECIPE_REF_RE).default('production') });

const getCatalogPoseInputSchema = z.object({
  recipe: z.string().min(1),
  pose: z.string().min(1),
  recipe_ref: z.string().regex(RECIPE_REF_RE).default('production'),
});

const listPresetsInputSchema = z.object({
  recipe: z.string().min(1).optional(),
  kind: presetKindSchema.optional(),
  include_deprecated: z.boolean().optional(),
});

const getPresetInputSchema = z.object({
  recipe: z.string().min(1),
  kind: presetKindSchema,
  name: z.string().min(1),
  version: z.number().int().positive().optional(),
});

const promoteToPoseInputSchema = z.object({
  generation_id: z.string().min(1),
  name: z.string().min(1),
  kind: presetKindSchema.default('pose'),
  base_version: z.number().int().positive().optional(),
  note: z.string().optional(),
  idempotency_key: z.string().min(1),
});

export function createChimeraMcpServer(env: Bindings, origin: string, executionCtx?: Waitable): McpServer {
  const db = env.DB;
  const bucket = env.IMAGES;
  const server = new McpServer({ name: 'chimera', version: '1.0.0' });

  /** hub 通知はレスポンスを待たせない。ExecutionContext が無ければ (テスト等) その場の Promise に任せる。 */
  function notifyHubInBackground(...args: Parameters<typeof notifyHub>): void {
    const promise = notifyHub(...args);
    if (executionCtx) executionCtx.waitUntil(promise);
  }

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
          base_generation_id: r.base_generation_id,
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
        "Non-destructive: only adds a new Run record under an Experiment. Never deletes or overwrites existing data. Idempotent by idempotency_key. " +
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
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: createRunInputSchema,
    },
    async ({ experiment_id, overrides, objective, parent_run_id, idempotency_key, variables }) => {
      const experiment = await getExperimentOr404(db, experiment_id);
      const { row, created, request_id } = await createExperimentRun(
        db,
        experiment,
        { overrides, objective, parent_run_id, idempotency_key, variables },
        { recipeRef: defaultRecipeRef(env) },
      );
      if (created && request_id) {
        const requestRow = await getRequestOr404(db, request_id);
        notifyHubInBackground(env, 'queued', requestRow);
      }
      return jsonResult({ created, run: { ...serializeExperimentRun(row), request_id } });
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
          base_generation_id: experiment.base_generation_id,
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
        "Non-destructive: records which Generation represents a Run; it does not modify or delete the Generation or the Batch. " +
        'Attach a Generation (the representative result) to a Run. The Run must already have a Batch attached, and the Generation must belong to that Batch. 409s if the Run already has a different Generation attached, if no Batch is attached yet, or if the Generation belongs to a different Batch.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      description:
        "Non-destructive: writes a note-like evaluation object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s evaluation. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      description:
        "Non-destructive: writes a note-like decision object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s decision. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ run_id: z.string().min(1), decision: jsonObject.nullable() }),
    },
    async ({ run_id, decision }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { decision });
      return jsonResult(serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'create_request',
    {
      description:
        "Non-destructive: only appends one new queued draft row to the requests table. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a requests row for the worker (docs/worker-protocol.md). kind is "generate" (a request.json v1 payload, ' +
        'schema_version/request/generation required), "finalize" (payload {generation_id, options?}), or "repair" ' +
        '(payload {generation_id, options?}, a masked local redraw of hands/feet), or "masked_redraw" ' +
        '(payload {generation_id, options} with explicit arbitrary regions and a prompt patch). created_by is ' +
        'forced to "mcp". Pass a stable idempotency_key: the same key with the same kind/payload replays the original ' +
        'row (created: false); the same key with a different kind/payload is a 409 tool error.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: createRequestInputSchema,
    },
    async ({ kind, payload, recipe_ref, idempotency_key }) => {
      const { row, created } = await createRequest(
        db,
        { kind, payload, recipe_ref, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult({ created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'finalize_generation',
    {
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a finalize request (docs/worker-protocol.md "finalize"): one ComfyUI graph that redraws the pick ' +
        'at delivery size, cuts a matte, and composites the backdrop and purple stroke; recorded as a refinement ' +
        "Batch of the source Generation, with a rebuild Reference back to it. generation_id accepts a short_id. " +
        'options is optional; every field defaults to the worker/recipe default when omitted: ' +
        'denoise (redraw strength; recipe default, e.g. 0.55 for an IL finalize, 0.75 for Anima alone), ' +
        'repin (accent-compression recolor pass), recolor (palette recolor, yukari recipe only), ' +
        'keep_legwear (keep tights/legwear — true for the worker default weight 0.62, or a number), ' +
        'route ("latent" or "pixel", worker default), size (redraw longest side, worker default), ' +
        'handdrawn (handdrawn-look pass), skin (skin pass), ' +
        'toe_guard (toe-repair guard — true for the worker default weight, or a number), ' +
        'keep_scene (keep background/scene), transparent (cut alpha instead of an opaque backdrop, worker default), ' +
        'backdrop (backdrop, e.g. "stripes" or a #RRGGBB color), ' +
        'upscale (resize method: bicubic/nearest-exact/bilinear/lanczos), ' +
        'lora_strength (finalize LoRA strength, 0-2), deliver_size (delivered file\'s longest side; the redraw itself stays at size), ' +
        'stroke_light (purple-stroke light direction: n/ne/e/se/s/sw/w/nw), ' +
        "repair (array of \"hands\"/\"feet\" to also mask-redraw in this same request), " +
        'repair_regions (explicit [x0,y0,x1,y1] fraction rectangles for that repair pass, worker auto-detects when omitted), ' +
        'repair_denoise (repair redraw strength), repair_pad (repair region padding factor), ' +
        'repair_size (repair redraw longest side). Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: finalizeGenerationInputSchema,
    },
    async ({ generation_id, options, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const payload: Record<string, unknown> = { generation_id: generation.short_id };
      if (options) payload.options = options;
      const { row, created } = await createRequest(
        db,
        { kind: 'finalize', payload, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult({ created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'repair_generation',
    {
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a repair request (docs/worker-protocol.md "repair"): a masked local redraw of hands and/or feet ' +
        'on an already finalized or raw Generation; recorded as a refinement Batch of the source Generation, the ' +
        'same lineage shape as finalize. generation_id accepts a short_id and may be either sibling of a finalize ' +
        "batch (the raw or the delivered Generation). options is optional; every field defaults to the worker/recipe " +
        'default when omitted: parts (array of "hands"/"feet" to redraw, worker default both), ' +
        'regions (explicit [x0,y0,x1,y1] fraction rectangles, worker auto-detects when omitted), ' +
        'denoise (redraw strength, recipe default), seeds (up to 16 seeds to try, worker default), ' +
        'size (redraw longest side, recipe default), pad (detected-region padding factor, worker default). ' +
        'Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: repairGenerationInputSchema,
    },
    async ({ generation_id, options, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const payload: Record<string, unknown> = { generation_id: generation.short_id };
      if (options) payload.options = options;
      const { row, created } = await createRequest(
        db,
        { kind: 'repair', payload, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult({ created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'masked_redraw_generation',
    {
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a generic masked redraw / garment inpaint request (docs/worker-protocol.md "masked_redraw"): ' +
        'the source Generation is left unchanged and the worker creates a new refinement Batch with a rebuild ' +
        'Reference back to it. generation_id accepts a short_id. options requires one or more non-overlapping ' +
        'normalized [x0,y0,x1,y1] rectangles and a non-empty prompt_patch; denoise is (0,0.75], ' +
        'mask_padding/mask_feather are pixel distances (pad/feather are accepted and canonicalized aliases), and size/seeds are optional. ' +
        'Use this for arbitrary garment or local redraw regions; use repair_generation for the hands/feet-specific compatibility API. ' +
        'Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: maskedRedrawGenerationInputSchema,
    },
    async ({ generation_id, options, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const payload: Record<string, unknown> = { generation_id: generation.short_id, options };
      const { row, created } = await createRequest(
        db,
        { kind: 'masked_redraw', payload, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult({ created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'get_request',
    {
      description: 'Get a requests row by id, including its payload and (once done/failed) result/error.',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const row = await getRequestOr404(db, id);
      return jsonResult(serializeRequest(row));
    },
  );

  server.registerTool(
    'list_requests',
    {
      description: 'List requests rows, optionally filtered by status, kind, or run_id. Read-only; does not claim.',
      inputSchema: z.object({
        status: requestStatusSchema.optional(),
        kind: requestKindSchema.optional(),
        run_id: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, kind, run_id }) => {
      const rows = await listRequests(db, { status, kind, run_id }, 200, 0);
      return jsonResult({ items: rows.map(serializeRequest) });
    },
  );

  server.registerTool(
    'list_generations',
    {
      description:
        'Find a Generation to start from when you do not already have a short_id — every other Generation tool ' +
        '(get_generation, get_generation_lineage, get_generation_image, finalize_generation, repair_generation, ' +
        "masked_redraw_generation, derive_request) assumes you already have one. Filters mirror the gallery's own " +
        'filters (character, tag, rating, bookmark, created_at range) and combine freely; tag="publish" marks a ' +
        'look that was delivered. rating is written by the human only, never by an agent — read it as the human\'s ' +
        'verdict on the image, not something to set. Results are newest-first (created_at desc), paginated via ' +
        'limit/offset (limit caps at 200, defaults to 50). Pick a short_id from the results and follow up with ' +
        'get_generation / get_generation_lineage / get_generation_image.',
      inputSchema: listGenerationsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ tag, rating, bookmark, character, from, to, limit, offset }) => {
      const query: Record<string, string | undefined> = {
        tag,
        rating,
        character,
        from,
        to,
        bookmark: bookmark === undefined ? undefined : bookmark ? 'true' : 'false',
        limit: limit === undefined ? undefined : String(limit),
        offset: offset === undefined ? undefined : String(offset),
      };
      const { items, total } = await queryGenerations(db, query, origin);
      return jsonResult({
        items: items.map((item) => ({
          short_id: item.short_id,
          rating: item.rating,
          bookmark: item.bookmark,
          tags: item.tags,
          summary: item.summary,
          character: item.character,
          created_at: item.created_at,
          batch_id: item.batch_id,
          canonical_url: item.canonical_url,
        })),
        total,
      });
    },
  );

  server.registerTool(
    'get_generation',
    {
      description: 'Get a Generation (by id or short_id) with its batch, comfy_job (graph/render_facts) and reference links — same shape as GET /api/v1/generations/{id}.',
      inputSchema: z.object({ generation_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ generation_id }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      return jsonResult(await getGenerationDetail(db, origin, generation));
    },
  );

  server.registerTool(
    'list_batch',
    {
      description:
        'Get a Batch (by id or short_id) with its jobs, generations (rating/bookmark/tags/semantic_summary/semantic_attributes/seed), ' +
        'references, relations (outgoing/incoming) and its ExperimentRun family, if any.',
      inputSchema: z.object({ batch_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ batch_id }) => {
      const batch = await getBatchByIdOrShortId(db, batch_id);
      if (!batch) throw notFound('batch');
      return jsonResult(await getBatchDigest(db, origin, batch));
    },
  );

  server.registerTool(
    'get_generation_lineage',
    {
      description:
        'Walk a Generation\'s Batch lineage: ancestors (material Batches it referenced, and the Batch it was refined/retried from) ' +
        'and descendants (Batches that referenced or were refined from it), each annotated with how they connect ' +
        "(via 'reference' or 'relation', with the reference purpose or relation type) and its own Generations " +
        '(short_id/rating/semantic_summary). depth defaults to 5, capped at 10.',
      inputSchema: generationLineageInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ generation_id, depth }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      return jsonResult(await getGenerationLineage(db, generation, depth));
    },
  );

  server.registerTool(
    'derive_request',
    {
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything, and never modifies the parent Generation. Idempotent by idempotency_key. " +
        'Enqueue a generate request derived from an existing Generation: carries the parent Batch\'s recipe/parameters/patches ' +
        'forward, merging `parameters` over the parent\'s and appending (or, with replace_patches, replacing) `patches`. ' +
        'If from_generation_id is a finalized or repaired Generation, it is resolved back to the raw Generation it was made ' +
        'from before deriving (finalize/repair payloads are not generate parameters). ' +
        '404s if from_generation_id does not resolve; 409s if the resolved source Batch has no single recipe (graph-mode) ' +
        'or if a refinement Batch in the chain has no rebuild reference to resolve through. ' +
        'seeds, if given, must have exactly `count` entries. reference is recorded as a purpose="derive" Reference back to the ' +
        'resolved source Generation (plus a second purpose="derive" aspect="finalized" reference to the requested Generation ' +
        'when it differs from the source). Pass a stable idempotency_key — the same key replays the original request ' +
        '(created: false) instead of creating a duplicate.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: deriveRequestInputSchema,
    },
    async ({
      from_generation_id,
      instruction,
      count,
      seeds,
      parameters,
      patches,
      replace_patches,
      semantic,
      reference,
      idempotency_key,
      recipe_ref,
    }) => {
      const requestedGeneration = await resolveGenerationOr404(db, from_generation_id);
      const { generation: sourceGeneration, batch: sourceBatch } = await resolveDerivationSource(db, requestedGeneration);

      const parentPatches = parseJsonArray(sourceBatch.patches_json);
      const parentPresets = parseJsonArray(sourceBatch.preset_versions_json) as { kind: string; name: string; version: number }[];

      const payload = buildDerivedRequestPayload({
        parentGenerationId: sourceGeneration.id,
        requestedGenerationId: requestedGeneration.id,
        parentRecipe: sourceBatch?.recipe ?? null,
        parentParameters: parseJsonObjectOrNull(sourceBatch?.parameters_json ?? null) ?? {},
        parentPatches,
        parentPresets,
        instruction,
        count,
        seeds,
        parameters,
        patches,
        replacePatches: replace_patches,
        semantic,
        reference,
      });

      const { row, created } = await createRequest(
        db,
        { kind: 'generate', payload, recipe_ref, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult({
        created,
        request: serializeRequest(row),
        payload,
        derived_from: {
          requested: { id: requestedGeneration.id, short_id: requestedGeneration.short_id },
          source: { id: sourceGeneration.id, short_id: sourceGeneration.short_id },
        },
      });
    },
  );

  server.registerTool(
    'list_catalog',
    {
      description:
        'Get the published recipe catalog summary for recipe_ref (default "production"): recipe names with their ' +
        'pose/costume/expression NAMES, per-recipe parameters, the patches vocabulary, and git info. No prompt bodies — ' +
        'use get_catalog_pose for a single pose\'s full record.',
      inputSchema: listCatalogInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      return jsonResult({
        recipe_ref: found.row.recipe_ref,
        published_at: found.row.published_at,
        updated_at: found.row.updated_at,
        ...summarizeCatalog(found.doc),
      });
    },
  );

  server.registerTool(
    'get_catalog_pose',
    {
      description: 'Get a single pose record (full body, prompts included) from the published catalog for recipe_ref (default "production").',
      inputSchema: getCatalogPoseInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, pose, recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      const record = findCatalogPose(found.doc, recipe, pose);
      if (!record) throw notFound(`pose '${pose}' in recipe '${recipe}'`);
      return jsonResult(record);
    },
  );

  server.registerTool(
    'list_presets',
    {
      description:
        'List Presets (pose/costume/expression), one row per name at its latest version — no record body. ' +
        "Unlike list_catalog/get_catalog_pose, which read the comfyui-recipes catalog snapshot, Presets are " +
        "chimera's own versioned source of truth for prompt bodies (docs/domain-model.md#preset). Defaults to " +
        'status=active only; include_deprecated also surfaces names whose latest version has been deprecated.',
      inputSchema: listPresetsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, include_deprecated }) => {
      const items = await listPresets(db, { recipe, kind, includeDeprecated: include_deprecated });
      return jsonResult({ items });
    },
  );

  server.registerTool(
    'get_preset',
    {
      description:
        'Get a Preset resolved to its full body: record plus, for a promoted version, the patches accumulated ' +
        "from its base chain (oldest first). version defaults to the name's latest active version; an explicit " +
        'version can still be read once deprecated. Presets are chimera\'s own versioned source of truth for ' +
        'prompt bodies (docs/domain-model.md#preset) — unlike get_catalog_pose, which reads a comfyui-recipes snapshot.',
      inputSchema: getPresetInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, name, version }) => {
      const row = await getPresetRow(db, recipe, kind, name, version);
      if (!row) throw notFound(`preset '${recipe}/${kind}/${name}'`);
      const resolved = await resolvePreset(db, row);
      return jsonResult(serializeResolvedPreset(row, resolved));
    },
  );

  server.registerTool(
    'promote_to_pose',
    {
      description:
        'Non-destructive: only appends one new Preset version. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Turn a rating=good Generation into a new Preset version (docs/worker-protocol.md「preset の移行」段階 B). ' +
        'Never rewrites an existing version — always appends the next version of (recipe, kind, name); pass an ' +
        'existing name for a new version of it, or a new name to start it at version 1. base is the preset version ' +
        'the originating generate request pinned (generation.presets); if that request predates pinning and carries ' +
        'no pin, pass base_version explicitly — chimera never guesses a base. kind defaults to "pose". If ' +
        'generation_id is a finalized/repaired Generation, it is resolved back to the raw Generation the same way ' +
        'derive_request does, and recipe/base/patches are taken from there — but rating is read from generation_id ' +
        'itself. 409s when rating is not good, when the resolved source Batch has no recipe (graph-mode), or when ' +
        'neither a pin nor base_version is available. idempotency_key replay returns the already-created version ' +
        'unchanged.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: promoteToPoseInputSchema,
    },
    async ({ generation_id, name, kind, base_version, note, idempotency_key }) => {
      const result = await promoteGenerationToPreset(db, {
        generation_id,
        name,
        kind,
        base_version,
        note,
        idempotency_key,
        created_by: 'mcp',
      });
      return jsonResult(result);
    },
  );

  return server;
}
