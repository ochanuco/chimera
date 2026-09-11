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
  finalizeProfileRefSchema,
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
import { getPresetRow, listPresets, recipeHasPresets, resolvePreset, serializeResolvedPreset } from './lib/presets';
import { promoteGenerationToPreset, promoteGenerationToProfile } from './lib/promote';
import { createObservationObjectSchema, observationOutcomeSchema, requirePoseOrComponent } from './schemas/observations';
import { createObservation, getObservation, listObservations } from './lib/observations';
import { publicationUrlSchema } from './schemas/publications';
import { createPublication, serializePublication } from './lib/publications';
import { getBatchByIdOrShortId } from './lib/db';
import { notifyHub, type Waitable } from './lib/hub-notify';
import { canonicalGenerationUrl, serializeExperimentRun, serializeRequest } from './lib/serialize';
import { mcpOutputSchemas } from './schemas/mcp-output';
import { parseJsonObjectOrNull } from './lib/overrides';
import { foldBatchDigestPrompts, foldGenerationDetailPrompts, foldRequestPayloadPrompts } from './lib/prompt-fold';
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

/** looseObject が付ける string index signature を落とす。これが残ると interface 由来の戻り値が構造的に代入不能になる。 */
type Declared<T> = T extends readonly (infer U)[]
  ? Declared<U>[]
  : T extends object
    ? { [K in keyof T as string extends K ? never : K]: Declared<T[K]> }
    : T;

/** get_generation_image だけは image block を返すため jsonResult を通らず、structuredContent を直に組む。 */
type ImageResult = Declared<z.infer<typeof mcpOutputSchemas.get_generation_image>>;

// text と structuredContent の両方を返す。outputSchema を宣言した tool は
// structuredContent が無いと SDK が ProtocolError にするし、outputSchema を読まない
// client のために text も要る（MCP 仕様 SEP-2106 §4.3 と同じ二重掲載）。
// schema 引数は型の witness で、実行時には使わない。値で受け取らないと型引数の
// 指定漏れが unknown に潰れて素通りし、schema と実体のずれが client 側の
// validation error になるまで出てこない。
function jsonResult<S extends z.ZodType>(_schema: S, data: Declared<z.infer<S>>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
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

// 呼び出し側が repair の crop 用 prompt で prompt.positive を丸ごと replace し、identity の
// 指定を消した事故があった。create_request と derive_request で同じ案内を出す。
function promptPartGuidance(identityOverrideField: string): string {
  return (
    'Prompt edits: to change only expression, background, pose or another single aspect, patch that part alone with ' +
    'target "prompt.positive.<part>" (op append/prepend/replace/remove, as for any patch); part names are the pose\'s ' +
    '`parts` from get_catalog_pose (list_catalog lists each recipe\'s parts; a recipe with no parts has no part targets). ' +
    'Avoid replacing the whole "prompt.positive": it easily drops the recipe\'s identity_tags (hair and eye color, ' +
    'sidelocks, hair ornament, cardigan/hood — listed by list_catalog), and the worker fails any request whose patches or ' +
    `prompt override remove them. Only when changing identity on purpose, give the reason in ${identityOverrideField}; ` +
    'the worker then renders it and records identity_override and identity_removed in semantic.attributes. ' +
    'Never reuse render_facts prompts from get_generation where comfy_job.prompt_not_reusable is set. '
  );
}

// negative で furniture などを禁止しても描き足しは消えず、layerdiffuse だけが効いた (2026-09-10 の本番実験)。
function backgroundRemovalGuidance(layerdiffuseField: string): string {
  return (
    `To remove the background or furniture the model adds on its own, set ${layerdiffuseField} (recipes yukari and ` +
    'yukari-sketch; yukari-anima rejects it): the background comes out transparent and objects not touching the figure ' +
    'disappear, while props the pose touches (a table, a cup) stay. Banning them in the negative prompt does not remove ' +
    'them. A finalize of a layerdiffuse Generation defaults to a transparent sticker. '
  );
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

/** `finalize_generation` の入力。options / profile は finalizePayloadSchema と同じ語彙 (schemas/requests.ts) をそのまま流用する。 */
const finalizeGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: finalizeOptionsSchema.optional(),
  profile: finalizeProfileRefSchema.optional(),
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
    identity_override: z.string().trim().min(1).optional(),
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
  published: z.boolean().optional(),
  rating: z.enum(['bad', 'neutral', 'good']).optional(),
  bookmark: z.boolean().optional(),
  character: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

/** `record_publication` の入力。generation_id は short_id / UUID どちらでも受ける。 */
const recordPublicationInputSchema = z.object({
  generation_id: z.string().min(1),
  url: publicationUrlSchema.nullable().optional(),
  published_at: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
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

const promoteToProfileInputSchema = z.object({
  generation_id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().optional(),
  idempotency_key: z.string().min(1),
});

const listObservationsInputSchema = z.object({
  character: z.string().min(1).optional(),
  pose: z.string().min(1).optional(),
  component: z.string().min(1).optional(),
  parameter: z.string().min(1).optional(),
  outcome: observationOutcomeSchema.optional(),
  q: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

const getObservationInputSchema = z.object({ id: z.string().min(1) });

/**
 * record_observation は observed_at を持たない — それは import 由来 (JSONL の記録日) 専用の
 * 欄で、MCP から今書く Observation には意味がない。base の ZodObject を
 * createObservationObjectSchema (schemas/observations.ts) から借り、同じ pose/component
 * 必須 refine をかけ直す。
 */
const recordObservationInputSchema = createObservationObjectSchema.omit({ observed_at: true }).superRefine(requirePoseOrComponent);

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
      outputSchema: mcpOutputSchemas.list_experiments,
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
      return jsonResult(mcpOutputSchemas.list_experiments, { items });
    },
  );

  server.registerTool(
    'get_experiment',
    {
      outputSchema: mcpOutputSchemas.get_experiment,
      description: 'Get an Experiment (by id or short_id) with its runs, promotions and tags — same shape as GET /api/v1/experiments/{id}.',
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const experiment = await getExperimentOr404(db, id);
      return jsonResult(mcpOutputSchemas.get_experiment, await getExperimentDetail(db, experiment, origin));
    },
  );

  server.registerTool(
    'create_run',
    {
      outputSchema: mcpOutputSchemas.create_run,
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
      return jsonResult(mcpOutputSchemas.create_run, { created, run: { ...serializeExperimentRun(row), request_id } });
    },
  );

  server.registerTool(
    'get_run',
    {
      outputSchema: mcpOutputSchemas.get_run,
      description: "Get a Run, its attached batch, and that batch's generations (short_id, rating, image dimensions).",
      inputSchema: z.object({ run_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ run_id }) => {
      const run = await getRunOr404(db, run_id);
      const { decorated, experiment } = await getRunWithExperimentContext(db, run, origin);
      const generations = run.batch_id ? await listGenerationsLightForBatch(db, run.batch_id, origin) : [];
      return jsonResult(mcpOutputSchemas.get_run, {
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
      outputSchema: mcpOutputSchemas.get_generation_image,
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
        structuredContent: {
          short_id: generation.short_id,
          canonical_url: canonicalUrl,
          inlined: false,
          mime_type: null,
          reason,
        } satisfies ImageResult,
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
        structuredContent: {
          short_id: generation.short_id,
          canonical_url: canonicalUrl,
          inlined: true,
          mime_type: mimeType,
          reason: null,
        } satisfies ImageResult,
      };
    },
  );

  server.registerTool(
    'attach_generation',
    {
      outputSchema: mcpOutputSchemas.attach_generation,
      description:
        "Non-destructive: records which Generation represents a Run; it does not modify or delete the Generation or the Batch. " +
        'Attach a Generation (the representative result) to a Run. The Run must already have a Batch attached, and the Generation must belong to that Batch. 409s if the Run already has a different Generation attached, if no Batch is attached yet, or if the Generation belongs to a different Batch.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ run_id: z.string().min(1), generation_id: z.string().min(1) }),
    },
    async ({ run_id, generation_id }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { generation_id });
      return jsonResult(mcpOutputSchemas.attach_generation, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_evaluation',
    {
      outputSchema: mcpOutputSchemas.set_evaluation,
      description:
        "Non-destructive: writes a note-like evaluation object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s evaluation. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ run_id: z.string().min(1), evaluation: jsonObject.nullable() }),
    },
    async ({ run_id, evaluation }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { evaluation });
      return jsonResult(mcpOutputSchemas.set_evaluation, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_decision',
    {
      outputSchema: mcpOutputSchemas.set_decision,
      description:
        "Non-destructive: writes a note-like decision object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s decision. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({ run_id: z.string().min(1), decision: jsonObject.nullable() }),
    },
    async ({ run_id, decision }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { decision });
      return jsonResult(mcpOutputSchemas.set_decision, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'create_request',
    {
      outputSchema: mcpOutputSchemas.create_request,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a requests row for the worker (docs/worker-protocol.md). kind is "generate" (a request.json v1 payload, ' +
        'schema_version/request/generation required), "finalize" (payload {generation_id, options?}), or "repair" ' +
        '(payload {generation_id, options?}, a masked local redraw of hands/feet), or "masked_redraw" ' +
        '(payload {generation_id, options} with explicit arbitrary regions and a prompt patch). created_by is ' +
        'forced to "mcp". ' +
        promptPartGuidance('generation.identity_override (a non-empty string) of the generate payload') +
        backgroundRemovalGuidance(
          'generation.parameters.layerdiffuse: true in a kind "generate" payload (to redo an existing Generation that way, ' +
            'use derive_request with parameters: {layerdiffuse: true})',
        ) +
        'Pass a stable idempotency_key: the same key with the same kind/payload replays the original ' +
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
      return jsonResult(mcpOutputSchemas.create_request, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'finalize_generation',
    {
      outputSchema: mcpOutputSchemas.finalize_generation,
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
        'keep_scene (keep background/scene), transparent (cut alpha instead of an opaque backdrop, worker default; ' +
        'for a layerdiffuse Generation the default is a transparent sticker — white band and purple stroke, alpha 0 ' +
        'outside — and only backdrop, keep_scene or transparent: false take the opaque banded route), ' +
        'backdrop (backdrop, e.g. "stripes" or a #RRGGBB color), ' +
        'upscale (resize method: bicubic/nearest-exact/bilinear/lanczos), ' +
        'lora_strength (finalize LoRA strength, 0-2), deliver_size (delivered file\'s longest side; the redraw itself stays at size), ' +
        'stroke_light (purple-stroke light direction: n/ne/e/se/s/sw/w/nw), ' +
        "repair (array of \"hands\"/\"feet\" to also mask-redraw in this same request), " +
        'repair_regions (explicit [x0,y0,x1,y1] fraction rectangles for that repair pass, worker auto-detects when omitted), ' +
        'repair_denoise (repair redraw strength), repair_pad (repair region padding factor), ' +
        'repair_size (repair redraw longest side), ' +
        'repair_lora (part LoRA for the redrawn hands/feet: true for the worker default weight, or a number). ' +
        'Every dial-able option (denoise, keep_legwear, toe_guard, lora_strength, repair_denoise, repair_lora) also accepts ' +
        'a word string instead of a number/true — the word vocabulary for this recipe is list_catalog\'s ' +
        'recipes[].dials.finalize (chimera only checks the type; the worker resolves the word). ' +
        'profile {name, version?} resolves a finalize Preset (list_presets kind="finalize") for the source ' +
        "Generation's recipe (latest active version when version is omitted) and uses its options as the base — " +
        'any key also given in options overrides it, explicit null included. Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: finalizeGenerationInputSchema,
    },
    async ({ generation_id, options, profile, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const payload: Record<string, unknown> = { generation_id: generation.short_id };
      if (options) payload.options = options;
      if (profile) payload.profile = profile;
      const { row, created } = await createRequest(
        db,
        { kind: 'finalize', payload, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputSchemas.finalize_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'repair_generation',
    {
      outputSchema: mcpOutputSchemas.repair_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a repair request (docs/worker-protocol.md "repair"): a masked local redraw of hands and/or feet ' +
        'on an already finalized or raw Generation; recorded as a refinement Batch of the source Generation, the ' +
        'same lineage shape as finalize. generation_id accepts a short_id and may be either sibling of a finalize ' +
        "batch (the raw or the delivered Generation). options is optional; every field defaults to the worker/recipe " +
        'default when omitted: parts (array of "hands"/"feet" to redraw, worker default both), ' +
        'regions (explicit [x0,y0,x1,y1] fraction rectangles, worker auto-detects when omitted), ' +
        'denoise (redraw strength, recipe default), seeds (up to 16 seeds to try, worker default), ' +
        'size (redraw longest side, recipe default), pad (detected-region padding factor, worker default), ' +
        'lora (part LoRA for the redrawn hands/feet: true for the worker default weight, or a number). ' +
        'denoise and lora also accept a word string instead of a number/true — the word vocabulary for this ' +
        "recipe is list_catalog's recipes[].dials.repair (chimera only checks the type; the worker resolves the word). " +
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
      return jsonResult(mcpOutputSchemas.repair_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'masked_redraw_generation',
    {
      outputSchema: mcpOutputSchemas.masked_redraw_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a generic masked redraw / garment inpaint request (docs/worker-protocol.md "masked_redraw"): ' +
        'the source Generation is left unchanged and the worker creates a new refinement Batch with a rebuild ' +
        'Reference back to it. generation_id accepts a short_id. options requires one or more non-overlapping ' +
        'normalized [x0,y0,x1,y1] rectangles and a non-empty prompt_patch; denoise is (0,0.75] or a word string ' +
        "(chimera only checks the word's type; no catalog dials namespace is defined for masked_redraw yet, so " +
        'validity is the worker\'s concern), ' +
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
      return jsonResult(mcpOutputSchemas.masked_redraw_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'get_request',
    {
      outputSchema: mcpOutputSchemas.get_request,
      description:
        'Get a requests row by id, including its payload and (once done/failed) result/error. ' +
        'Prompt bodies (prompt overrides, prompt patches) in the payload are folded to a length marker by default; ' +
        'pass include_prompts: true only when you actually need the text.',
      inputSchema: z.object({ id: z.string().min(1), include_prompts: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, include_prompts }) => {
      const row = await getRequestOr404(db, id);
      const serialized = serializeRequest(row);
      const payload = include_prompts ? serialized.payload : foldRequestPayloadPrompts(serialized.payload);
      return jsonResult(mcpOutputSchemas.get_request, { ...serialized, payload });
    },
  );

  server.registerTool(
    'list_requests',
    {
      outputSchema: mcpOutputSchemas.list_requests,
      description:
        'List requests rows, optionally filtered by status, kind, or run_id. Read-only; does not claim. ' +
        'Prompt bodies (prompt overrides, prompt patches) in each payload are folded to a length marker by default; ' +
        'pass include_prompts: true only when you actually need the text.',
      inputSchema: z.object({
        status: requestStatusSchema.optional(),
        kind: requestKindSchema.optional(),
        run_id: z.string().min(1).optional(),
        include_prompts: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, kind, run_id, include_prompts }) => {
      const rows = await listRequests(db, { status, kind, run_id }, 200, 0);
      const items = rows.map((row) => {
        const serialized = serializeRequest(row);
        const payload = include_prompts ? serialized.payload : foldRequestPayloadPrompts(serialized.payload);
        return { ...serialized, payload };
      });
      return jsonResult(mcpOutputSchemas.list_requests, { items });
    },
  );

  server.registerTool(
    'list_generations',
    {
      outputSchema: mcpOutputSchemas.list_generations,
      description:
        'Find a Generation to start from when you do not already have a short_id — every other Generation tool ' +
        '(get_generation, get_generation_lineage, get_generation_image, finalize_generation, repair_generation, ' +
        "masked_redraw_generation, derive_request) assumes you already have one. Filters mirror the gallery's own " +
        'filters (character, tag, rating, bookmark, created_at range) and combine freely; published=true is the ' +
        "delivered-look index — every look that was posted, each still carrying its look:<pose> tag. rating is " +
        "written by the human only, never by an agent — read it as the human's verdict on the image, not something " +
        'to set. Results are newest-first (created_at desc), paginated via limit/offset (limit caps at 200, ' +
        'defaults to 50). Pick a short_id from the results and follow up with get_generation / ' +
        'get_generation_lineage / get_generation_image.',
      inputSchema: listGenerationsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ tag, published, rating, bookmark, character, from, to, limit, offset }) => {
      const query: Record<string, string | undefined> = {
        tag,
        rating,
        character,
        from,
        to,
        published: published === undefined ? undefined : published ? 'true' : 'false',
        bookmark: bookmark === undefined ? undefined : bookmark ? 'true' : 'false',
        limit: limit === undefined ? undefined : String(limit),
        offset: offset === undefined ? undefined : String(offset),
      };
      const { items, total } = await queryGenerations(db, query, origin);
      return jsonResult(mcpOutputSchemas.list_generations, {
        items: items.map((item) => ({
          short_id: item.short_id,
          rating: item.rating,
          bookmark: item.bookmark,
          tags: item.tags,
          published: item.published,
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
      outputSchema: mcpOutputSchemas.get_generation,
      description:
        'Get a Generation (by id or short_id) with its batch, comfy_job (graph/render_facts) and reference links — same shape as GET /api/v1/generations/{id}. ' +
        'comfy_job.prompt_not_reusable is non-null for repair, masked_redraw and repair-carrying finalize outputs: their ' +
        'render_facts prompts were cut for a masked region (face, hair and hood tags dropped), so never pass them as a ' +
        'generate prompt — use derive_request from the Generation instead. ' +
        'Prompt bodies (batch prompt/negative_prompt, render_facts sampler prompts, the ComfyUI graph) are folded to a ' +
        'length marker by default (the graph becomes null with comfy_job.graph_omitted: true); pass include_prompts: true ' +
        'only when you actually need the text.',
      inputSchema: z.object({ generation_id: z.string().min(1), include_prompts: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async ({ generation_id, include_prompts }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const detail = await getGenerationDetail(db, origin, generation);
      return jsonResult(mcpOutputSchemas.get_generation, include_prompts ? detail : foldGenerationDetailPrompts(detail));
    },
  );

  server.registerTool(
    'list_batch',
    {
      outputSchema: mcpOutputSchemas.list_batch,
      description:
        'Get a Batch (by id or short_id) with its jobs, generations (rating/bookmark/tags/semantic_summary/semantic_attributes/seed), ' +
        'references, relations (outgoing/incoming) and its ExperimentRun family, if any. ' +
        'Prompt bodies (batch prompt/negative_prompt, batch.parameters.prompt_patch, render_facts sampler prompts) are ' +
        'folded to a length marker by default; pass include_prompts: true only when you actually need the text.',
      inputSchema: z.object({ batch_id: z.string().min(1), include_prompts: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async ({ batch_id, include_prompts }) => {
      const batch = await getBatchByIdOrShortId(db, batch_id);
      if (!batch) throw notFound('batch');
      const digest = await getBatchDigest(db, origin, batch);
      return jsonResult(mcpOutputSchemas.list_batch, include_prompts ? digest : foldBatchDigestPrompts(digest));
    },
  );

  server.registerTool(
    'get_generation_lineage',
    {
      outputSchema: mcpOutputSchemas.get_generation_lineage,
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
      return jsonResult(mcpOutputSchemas.get_generation_lineage, await getGenerationLineage(db, generation, depth));
    },
  );

  server.registerTool(
    'derive_request',
    {
      outputSchema: mcpOutputSchemas.derive_request,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything, and never modifies the parent Generation. Idempotent by idempotency_key. " +
        'Enqueue a generate request derived from an existing Generation: carries the parent Batch\'s recipe/parameters/patches ' +
        'forward, merging `parameters` over the parent\'s and appending (or, with replace_patches, replacing) `patches`. ' +
        'If from_generation_id is a finalized or repaired Generation, it is resolved back to the raw Generation it was made ' +
        'from before deriving (finalize/repair payloads are not generate parameters). ' +
        '404s if from_generation_id does not resolve; 409s if the resolved source Batch has no single recipe (graph-mode) ' +
        'or if a refinement Batch in the chain has no rebuild reference to resolve through; ' +
        'or if the source Batch carries patches but no pinned preset version on a recipe that has presets — pass ' +
        'replace_patches: true (with patches restated against the current preset) or derive from a pinned batch instead. ' +
        'seeds, if given, must have exactly `count` entries. reference is recorded as a purpose="derive" Reference back to the ' +
        'resolved source Generation (plus a second purpose="derive" aspect="finalized" reference to the requested Generation ' +
        'when it differs from the source). ' +
        promptPartGuidance('identity_override (written to generation.identity_override; not carried from the parent)') +
        backgroundRemovalGuidance('parameters: {layerdiffuse: true}') +
        'Pass a stable idempotency_key — the same key replays the original request ' +
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
      identity_override,
      idempotency_key,
      recipe_ref,
    }) => {
      const requestedGeneration = await resolveGenerationOr404(db, from_generation_id);
      const { generation: sourceGeneration, batch: sourceBatch } = await resolveDerivationSource(db, requestedGeneration);

      const parentPatches = parseJsonArray(sourceBatch.patches_json);
      const parentPresets = parseJsonArray(sourceBatch.preset_versions_json) as { kind: string; name: string; version: number }[];
      const parentRecipeHasPresets = sourceBatch.recipe ? await recipeHasPresets(db, sourceBatch.recipe) : false;

      const payload = buildDerivedRequestPayload({
        parentGenerationId: sourceGeneration.id,
        requestedGenerationId: requestedGeneration.id,
        parentRecipe: sourceBatch?.recipe ?? null,
        parentParameters: parseJsonObjectOrNull(sourceBatch?.parameters_json ?? null) ?? {},
        parentPatches,
        parentPresets,
        parentRecipeHasPresets,
        instruction,
        count,
        seeds,
        parameters,
        patches,
        replacePatches: replace_patches,
        semantic,
        reference,
        identityOverride: identity_override,
      });

      const { row, created } = await createRequest(
        db,
        { kind: 'generate', payload, recipe_ref, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputSchemas.derive_request, {
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
      outputSchema: mcpOutputSchemas.list_catalog,
      description:
        'Get the published recipe catalog summary for recipe_ref (default "production"): recipe names with their ' +
        'pose/costume/expression NAMES, prompt part names (`parts`, the <part> of a "prompt.positive.<part>" patch target) ' +
        'and `identity_tags` (the tags a request must not drop without generation.identity_override) where the recipe ' +
        'has them, per-recipe parameters, the patches vocabulary, `dials` (word -> number maps for finalize/repair ' +
        'dial-able options, keyed by the option name — the word vocabulary finalize_generation/repair_generation accept ' +
        'in place of a number), and git info. No prompt bodies — use get_catalog_pose for a single pose\'s full record.',
      inputSchema: listCatalogInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      return jsonResult(mcpOutputSchemas.list_catalog, {
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
      outputSchema: mcpOutputSchemas.get_catalog_pose,
      description:
        'Get a single pose record (full body, prompts included) from the published catalog for recipe_ref (default "production"). ' +
        'Where the recipe splits its prompt into parts, `parts` is [{name, text}] in order (the texts concatenate to the ' +
        'positive prompt); patch one of them with target "prompt.positive.<name>" instead of replacing the whole prompt.',
      inputSchema: getCatalogPoseInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, pose, recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      const record = findCatalogPose(found.doc, recipe, pose);
      if (!record) throw notFound(`pose '${pose}' in recipe '${recipe}'`);
      // catalog は本文を持たない pose を裸の名前文字列で書ける。structuredContent は
      // object でなければならないので、その形だけここで {name} に揃える。
      return jsonResult(mcpOutputSchemas.get_catalog_pose, typeof record === 'string' ? { name: record } : record);
    },
  );

  server.registerTool(
    'list_presets',
    {
      outputSchema: mcpOutputSchemas.list_presets,
      description:
        'List Presets (pose/costume/expression/finalize), one row per name at its latest version — no record body. ' +
        "Unlike list_catalog/get_catalog_pose, which read the comfyui-recipes catalog snapshot, Presets are " +
        "chimera's own versioned source of truth for prompt bodies (docs/domain-model.md#preset). Defaults to " +
        'status=active only; include_deprecated also surfaces names whose latest version has been deprecated.',
      inputSchema: listPresetsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, include_deprecated }) => {
      const items = await listPresets(db, { recipe, kind, includeDeprecated: include_deprecated });
      return jsonResult(mcpOutputSchemas.list_presets, { items });
    },
  );

  server.registerTool(
    'get_preset',
    {
      outputSchema: mcpOutputSchemas.get_preset,
      description:
        'Get a Preset resolved to its full body: record plus, for a promoted version, the patches accumulated ' +
        "from its base chain (oldest first). version defaults to the name's latest active version; an explicit " +
        'version can still be read once deprecated. Presets are chimera\'s own versioned source of truth for ' +
        'prompt bodies (docs/domain-model.md#preset) — unlike get_catalog_pose, which reads a comfyui-recipes snapshot. ' +
        'kind "finalize" is a different shape: record is {options} (a finalize_generation options object, words ' +
        'preserved) and patches is always [] — it has no base chain.',
      inputSchema: getPresetInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, name, version }) => {
      const row = await getPresetRow(db, recipe, kind, name, version);
      if (!row) throw notFound(`preset '${recipe}/${kind}/${name}'`);
      const resolved = await resolvePreset(db, row);
      return jsonResult(mcpOutputSchemas.get_preset, serializeResolvedPreset(row, resolved));
    },
  );

  server.registerTool(
    'promote_to_pose',
    {
      outputSchema: mcpOutputSchemas.promote_to_pose,
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
      return jsonResult(mcpOutputSchemas.promote_to_pose, result);
    },
  );

  server.registerTool(
    'promote_to_profile',
    {
      outputSchema: mcpOutputSchemas.promote_to_profile,
      description:
        'Non-destructive: only appends one new Preset version. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Turn a rating=good finalize-kind Generation into a new kind="finalize" Preset version (a reusable profile of ' +
        'finalize options, docs/worker-protocol.md「finalize profile」). generation_id must be a Generation produced by a ' +
        'finalize request (the delivered Generation or, if it also carried a repair, either sibling) — found via the ' +
        "finalize request whose result attached this Generation's Batch. 409s when rating is not good or when " +
        'generation_id was not produced by a finalize request. The new version\'s body is that request\'s queued ' +
        'options verbatim (dial words preserved). Never rewrites an existing version — pass an existing name for a new ' +
        'version of it, or a new name to start it at version 1. idempotency_key replay returns the already-created ' +
        'version unchanged. Use the result with finalize_generation\'s profile input or list_presets kind="finalize".',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: promoteToProfileInputSchema,
    },
    async ({ generation_id, name, note, idempotency_key }) => {
      const result = await promoteGenerationToProfile(db, { generation_id, name, note, idempotency_key, created_by: 'mcp' });
      return jsonResult(mcpOutputSchemas.promote_to_profile, result);
    },
  );

  server.registerTool(
    'list_observations',
    {
      outputSchema: mcpOutputSchemas.list_observations,
      description:
        "List Observations, chimera's index of comfyui-recipes' experiments/ records (docs/domain-model.md#observation). " +
        'The index is not the source of truth — it can lag the JSONL files. Observation is history, not the current rule; ' +
        "the current rule lives in the pose recipe's own comments. Every reason is scoped to the pose/seed/tag block/canvas " +
        "it was observed under, not a general claim about the tag — treat a hit as one past data point, not a rule. " +
        'q matches parameter/value/reason by substring.',
      inputSchema: listObservationsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ character, pose, component, parameter, outcome, q, limit }) => {
      const { items, total } = await listObservations(
        db,
        { character, pose, component, parameter, outcome, q },
        { limit: limit ?? 50, offset: 0 },
      );
      return jsonResult(mcpOutputSchemas.list_observations, { items, total });
    },
  );

  server.registerTool(
    'get_observation',
    {
      outputSchema: mcpOutputSchemas.get_observation,
      description: 'Get one Observation by id (docs/domain-model.md#observation). 404s (as a tool error) when not found.',
      inputSchema: getObservationInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const row = await getObservation(db, id);
      if (!row) throw notFound('observation');
      return jsonResult(mcpOutputSchemas.get_observation, row);
    },
  );

  server.registerTool(
    'record_observation',
    {
      outputSchema: mcpOutputSchemas.record_observation,
      description:
        'Non-destructive: only appends one new Observation. Never deletes, overwrites, publishes or sends anything. ' +
        'Records what was tried for one parameter and what happened (docs/domain-model.md#observation). Requires pose and/or ' +
        "component (at least one). This is history, not the current rule — it does not change the pose recipe. The reason " +
        "you give is scoped to this pose/seed/tag block/canvas, not a general claim about the tag: don't write it as if it " +
        'settles the tag everywhere else in the project. Pass a fresh idempotency_key per observation you intend to record; ' +
        'resending the same key returns the row it already made. Measuring the same thing again and getting the same result ' +
        'is a separate observation, so give it its own key rather than reusing the first one. supersedes_id records that ' +
        'this Observation overturns an earlier one — the earlier row ' +
        'is never edited or deleted, since Observation is append-only.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: recordObservationInputSchema,
    },
    async (input) => {
      const row = await createObservation(db, input, 'mcp');
      return jsonResult(mcpOutputSchemas.record_observation, row);
    },
  );

  server.registerTool(
    'record_publication',
    {
      outputSchema: mcpOutputSchemas.record_publication,
      description:
        'Non-destructive: only records that a Generation was posted (docs/domain-model.md#publication). Never deletes, ' +
        'overwrites, or sends anything — it does not post to X itself, it just records that a posting happened. url is ' +
        'optional and can be filled in later (PATCH /api/v1/publications/{id} or the Generation Detail page). Pass a ' +
        'fresh idempotency_key per posting you intend to record; resending the same key returns the row it already made.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: recordPublicationInputSchema,
    },
    async ({ generation_id, url, published_at, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const { row } = await createPublication(db, generation.id, {
        url,
        publishedAt: published_at,
        createdBy: 'mcp',
        idempotencyKey: idempotency_key,
      });
      return jsonResult(mcpOutputSchemas.record_publication, serializePublication(row));
    },
  );

  return server;
}
