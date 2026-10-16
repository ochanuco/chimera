// chimera ドメインへの MCP インターフェース。docs/experiment-agent.md 参照。
// tool ハンドラは REST routes と同じ src/lib/*.ts の関数を呼び、guardrails (404/409) を二重に持たない。
// ApiError は握りつぶさず投げる: McpServer の tools/call ハンドラが catch してそのまま tool error のメッセージにする。

// 読み取り tool には readOnlyHint を付ける（annotation が無いと副作用ありとみなし、承認待ちで結果を返さない client がある）。
import { McpServer } from '@modelcontextprotocol/server';
import { notFound } from './lib/errors';
import { generatePayloadPatches } from './lib/patch-grammar';
import {
  createExperimentRun,
  createExperimentWithArms,
  getExperimentDetail,
  getExperimentOr404,
  getRunOr404,
  getRunWithExperimentContext,
  latestRunByExperiment,
  listGenerationsLightForRun,
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
import { getGenerationLineage } from './lib/lineage';
import { getCatalog, summarizeCatalog, findCatalogPose } from './lib/catalogs';
import { getPresetRow, listPresets, recipeHasPresets, resolvePreset, serializeResolvedPreset } from './lib/presets';
import { promoteGenerationToPreset, promoteGenerationToProfile } from './lib/promote';
import { attachReferences, getCurrentReference, referenceView, setPoseReference } from './lib/preset-references';
import { buildPlainRenderRequest } from './lib/plain-render';
import { createObservation, getObservation, listObservations } from './lib/observations';
import { createPublication, serializePublication } from './lib/publications';
import { computeSafetyVerdict, getSafetyForGeneration, publishWarningFor, type SafetyRating } from './lib/safety';
import { getGpuStatus } from './lib/gpu-wake';
import { notifyHub, type Waitable } from './lib/hub-notify';
import { canonicalExperimentUrl, canonicalGenerationUrl, serializeExperimentRun, serializeRequest } from './lib/serialize';
import { mcpOutputs } from './schemas/mcp-output';
import { presetPromoteRequestSchema, presetPromoteProfileRequestSchema } from './schemas/presets';
import {
  attachGenerationInputSchema,
  createExperimentInputSchema,
  createRequestInputSchema,
  createRunInputSchema,
  deliverGenerationInputSchema,
  deriveRequestInputSchema,
  dofGenerationInputSchema,
  emptyInputSchema,
  generationLineageInputSchema,
  getCatalogPoseInputSchema,
  getGenerationImageInputSchema,
  getGenerationInputSchema,
  getPresetInputSchema,
  getRequestInputSchema,
  getRunInputSchema,
  idInputSchema,
  lensGenerationInputSchema,
  lightingGenerationInputSchema,
  listCatalogInputSchema,
  listExperimentsInputSchema,
  listGenerationsInputSchema,
  listObservationsInputSchema,
  listPresetsInputSchema,
  listRequestsInputSchema,
  maskedRedrawGenerationInputSchema,
  photoGenerationInputSchema,
  plainRenderInputSchema,
  recordObservationInputSchema,
  recordPublicationInputSchema,
  redrawGenerationInputSchema,
  repairGenerationInputSchema,
  setDecisionInputSchema,
  setEvaluationInputSchema,
  setPoseReferenceInputSchema,
  stageGenerationInputSchema,
} from './schemas/mcp-input';
import { parseJsonObjectOrNull } from './lib/overrides';
import { mergedBaseParameters } from './lib/experiment-rules';
import type { StandardSchemaV1 } from './lib/standard-schema';
import { foldGenerationDetailPrompts, foldRequestPayloadPrompts } from './lib/prompt-fold';
import { MAX_TRANSFORM_INPUT_BYTES, generationPreviewR2Key } from './lib/generation-preview';
import type { Bindings } from './types';

/** MCP client の 1 MiB レスポンス上限に合わせる。base64 化で 4/3 に膨れる分と JSON-RPC envelope の余裕を見て 700 KiB に切り詰める。 */
const MAX_RETURNED_IMAGE_BYTES = 700 * 1024;

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
type ImageResult = Declared<StandardSchemaV1.InferOutput<typeof mcpOutputs.get_generation_image>>;

// content と structuredContent の両方を返す: outputSchema 宣言時は structuredContent が無いと SDK が
// ProtocolError にし、outputSchema 未対応の client のため text も要る（MCP SEP-2106 §4.3）。
// schema 引数は型の witness（実行時には使わない）。値で受けないと型引数の指定漏れが unknown に潰れて
// tsc で検出できなくなる。
function jsonResult<S extends StandardSchemaV1>(_schema: S, data: Declared<StandardSchemaV1.InferOutput<S>>) {
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

/** Uint8Array -> base64。`btoa(String.fromCharCode(...bytes))` は引数展開でスタック上限に当たるため chunk に分けて畳み込む。 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// prompt.positive の丸ごと replace は identity 指定を消す事故のもと。create_request と derive_request で同じ案内を出す。
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

/**
 * Server-level guidance in the initialize response: tool descriptions alone leave the client to guess the order
 * of operations, so a client seeing only a rating=good Generation re-invents a pose that already exists in the catalog.
 */
const MCP_INSTRUCTIONS =
  'chimera manages ComfyUI generations for chagama. Order of operations:\n' +
  '1. Start from list_catalog: it names every pose (and costume / expression) each recipe already has. Check it before ' +
  'writing a prompt patch for a look — the pose you want may already exist by name.\n' +
  '2. A named look is reproduced with plain_render(recipe, pose): it renders the recipe defaults at the seed of the ' +
  "pose's pinned basis render (set_pose_reference). Seed exploration also goes through plain_render with an explicit seed.\n" +
  "3. To derive from a look, start from the Generation in get_catalog_pose's `reference` (the current pin) and call " +
  'derive_request from it. A rating=good Generation found via list_generations may predate the pin — prefer the pin. ' +
  'get_generation reports which pose a Generation drew and that pose\'s current pin as request.drawn_pose.\n' +
  '4. Change prompts per part: patch target "prompt.positive.<part>" (part names from get_catalog_pose `parts`). ' +
  'Replacing prompt.positive wholesale drops identity tags and trips the identity guard.\n' +
  '5. A redrawn / delivered / repaired / masked_redraw Generation exposes the Generation it was made from as ' +
  '`refines_generation` ({id, short_id, rating}) in get_generation; it is null for a raw Generation. Change a picture ' +
  'with redraw_generation (one operation per request), then finish it with deliver_generation (cut-out, backdrop, ' +
  'a list of outlines) and, if wanted, blur the delivered picture with dof_generation (depth of field) and then bend it ' +
  'with lens_generation (fisheye / inverse fisheye). Blur first: dof refuses a lens picture. To shoot a delivered ' +
  'picture like an acrylic stand on location, stand it in an uploaded photo with photo_generation, or step by step: ' +
  'deliver transparent, stage_generation (a backdrop pattern or a photo), lighting_generation (light it by the ' +
  'backdrop), then dof_generation.\n' +
  '6. To compare variants, call create_experiment once per instruction: one arm per variant plus the control as an arm ' +
  'without patches, all sharing the same seeds. The experiment page shows every generation as a matrix: arms as rows, seeds as columns.';

export function createChimeraMcpServer(env: Bindings, origin: string, executionCtx?: Waitable): McpServer {
  const db = env.DB;
  const bucket = env.IMAGES;
  const server = new McpServer({ name: 'chimera', version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS });

  /** hub 通知はレスポンスを待たせない。ExecutionContext が無ければ (テスト等) その場の Promise に任せる。 */
  function notifyHubInBackground(...args: Parameters<typeof notifyHub>): void {
    const promise = notifyHub(...args);
    if (executionCtx) executionCtx.waitUntil(promise);
  }

  server.registerTool(
    'list_experiments',
    {
      outputSchema: mcpOutputs.list_experiments,
      description: 'List Experiments, optionally filtered by status. Each item carries its base_recipe/base_parameters and latest Run.',
      inputSchema: listExperimentsInputSchema,
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
      return jsonResult(mcpOutputs.list_experiments, { items });
    },
  );

  server.registerTool(
    'get_experiment',
    {
      outputSchema: mcpOutputs.get_experiment,
      description: 'Get an Experiment (by id or short_id) with its runs, promotions and tags — same shape as GET /api/v1/experiments/{id}.',
      inputSchema: idInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const experiment = await getExperimentOr404(db, id);
      return jsonResult(mcpOutputs.get_experiment, await getExperimentDetail(db, experiment, origin));
    },
  );

  server.registerTool(
    'create_experiment',
    {
      outputSchema: mcpOutputs.create_experiment,
      description:
        'Non-destructive: only adds a new Experiment and its Runs. Never deletes or overwrites existing data. Idempotent by idempotency_key. ' +
        'This is the way to compare variants: one instruction = one Experiment. Each arm becomes one Run with its own generate request, ' +
        'and the experiment page (url) shows every generation as a matrix, arms as rows and seeds as columns. ' +
        'recipe and parameters (pose, costume, ... and optionally count) are shared by every arm; pass seeds so all arms render the same seeds ' +
        'and the columns are comparable (seeds sets the request count, so omit count when giving seeds). ' +
        'arms: 1-9 entries {label, instruction?, patches?}; label must be unique within the call and is the row header of the arm. ' +
        'Include the control as an arm without patches. patches is a diff against the recipe, each {target, op, reason, value/old by op}; ' +
        'change one aspect per arm with per-part targets "prompt.positive.<part>" (part names from get_catalog_pose `parts`) instead of replacing the whole prompt. ' +
        'instruction is the arm\'s instruction text (defaults to the label). ' +
        'Retrying with the same idempotency_key returns the original Experiment and Runs with created=false; the same key with different arms is a 409. ' +
        'Returns the Experiment (id, short_id, url, compare_url) and per arm the Run id, request_id and request_short_id.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: createExperimentInputSchema,
    },
    async (input) => {
      const { experiment, runs, created } = await createExperimentWithArms(
        db,
        {
          experiment: {
            name: input.name,
            description: input.description,
            base_recipe: input.recipe,
            base_parameters: mergedBaseParameters(input),
            base_generation_id: input.base_generation_id,
            character_id: input.character_id,
          },
          arms: input.arms,
          idempotency_key: input.idempotency_key,
        },
        { recipeRef: defaultRecipeRef(env) },
      );
      const outRuns = [];
      for (const run of runs) {
        let requestShortId: string | null = null;
        if (run.request_id) {
          const requestRow = await getRequestOr404(db, run.request_id);
          requestShortId = requestRow.short_id;
          if (run.created) notifyHubInBackground(env, 'queued', requestRow);
        }
        outRuns.push({ id: run.row.id, arm: run.arm, request_id: run.request_id, request_short_id: requestShortId });
      }
      const url = canonicalExperimentUrl(origin, experiment.short_id);
      return jsonResult(mcpOutputs.create_experiment, {
        experiment: { id: experiment.id, short_id: experiment.short_id, url, compare_url: `${url}#experiment-compare` },
        runs: outRuns,
        created,
      });
    },
  );

  server.registerTool(
    'create_run',
    {
      outputSchema: mcpOutputs.create_run,
      description:
        "Non-destructive: only adds a new Run record under an Experiment. Never deletes or overwrites existing data. Idempotent by idempotency_key. " +
        'Create a new Run under an Experiment with the given overrides. The Run starts unexecuted (no request result yet). ' +
        'overrides is a diff against the Experiment\'s base recipe, shaped {"patches": [...]}. Each patch is ' +
        '{target, op, reason, plus value and/or old depending on op} — reason is required on every patch. ' +
        "chimera does not define the target/op vocabulary; it's the recipe's, on the chagama side — read " +
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
      return jsonResult(mcpOutputs.create_run, { created, run: { ...serializeExperimentRun(row), request_id } });
    },
  );

  server.registerTool(
    'get_run',
    {
      outputSchema: mcpOutputs.get_run,
      description: "Get a Run, its result request, and that request's generations (short_id, rating, image dimensions).",
      inputSchema: getRunInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ run_id }) => {
      const run = await getRunOr404(db, run_id);
      const { decorated, experiment } = await getRunWithExperimentContext(db, run, origin);
      const generations = await listGenerationsLightForRun(db, run.id, origin);
      return jsonResult(mcpOutputs.get_run, {
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
      outputSchema: mcpOutputs.get_generation_image,
      description:
        'Fetch a Generation image by short_id (or id). Returns it downscaled and re-encoded as JPEG — the MCP ' +
        "client caps a whole response at 1MB, which a full-size PNG blows past once base64-encoded — so it's for " +
        'judging composition, not pixel-level inspection. width (256-1024, default 768) trades detail for a ' +
        'smaller reply. Images too large to inline return the canonical URL instead. A Generation whose original ' +
        'was purged by the retention job is served from its 1024px preview instead. A Generation whose content-rating ' +
        'verdict is block never returns the image, only the canonical URL; get_generation still returns its data.',
      inputSchema: getGenerationImageInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ short_id, width }) => {
      const generation = await resolveGenerationOr404(db, short_id);
      const safetyRow = await getSafetyForGeneration(db, generation.id);
      const verdict = safetyRow
        ? computeSafetyVerdict(JSON.parse(safetyRow.rating_json) as SafetyRating, JSON.parse(safetyRow.tags_json) as Record<string, number>)
            .verdict
        : null;
      const canonicalUrl = canonicalGenerationUrl(origin, generation.short_id);
      const pointer = (reason: string) => ({
        content: [{ type: 'text' as const, text: `${reason} See ${canonicalUrl}` }],
        structuredContent: {
          short_id: generation.short_id,
          canonical_url: canonicalUrl,
          inlined: false,
          mime_type: null,
          reason,
          verdict,
        } satisfies ImageResult,
      });

      // 画像ブロックが client の内容分類器に当たると、会話ごとコネクタが止まることがある。
      if (verdict === 'block') return pointer('content-rating verdict is block; the image is not returned.');

      const sourceKey = generation.original_purged_at ? generationPreviewR2Key(generation.id) : generation.r2_object_key;
      const head = await bucket.head(sourceKey);
      if (!head) throw notFound('image');

      if (head.size > MAX_TRANSFORM_INPUT_BYTES) {
        return pointer(`image is ${head.size} bytes, over the ${MAX_TRANSFORM_INPUT_BYTES} byte transform input limit.`);
      }

      const object = await bucket.get(sourceKey);
      if (!object) throw notFound('image');

      // transform 用と失敗時フォールバック用に body を分ける（成功すればフォールバック側は読まれず捨てられる）。
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
        // 変換失敗（壊れた画像、binding 未提供など）でも tool call 自体は失敗させない。
        // 元画像がキャップ内に収まればそのまま返し、収まらなければポインタに落とす。
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
          verdict,
        } satisfies ImageResult,
      };
    },
  );

  server.registerTool(
    'attach_generation',
    {
      outputSchema: mcpOutputs.attach_generation,
      description:
        "Non-destructive: records which Generation represents a Run; it does not modify or delete the Generation or the Run's request. " +
        'Attach a Generation (the representative result) to a Run. The Run must already have a result request, and the Generation must belong to that request. 409s if the Run already has a different Generation attached, if the Run has no result request yet, or if the Generation belongs to a different request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: attachGenerationInputSchema,
    },
    async ({ run_id, generation_id }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { generation_id });
      return jsonResult(mcpOutputs.attach_generation, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_evaluation',
    {
      outputSchema: mcpOutputs.set_evaluation,
      description:
        "Non-destructive: writes a note-like evaluation object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s evaluation. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: setEvaluationInputSchema,
    },
    async ({ run_id, evaluation }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { evaluation });
      return jsonResult(mcpOutputs.set_evaluation, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'set_decision',
    {
      outputSchema: mcpOutputs.set_decision,
      description:
        "Non-destructive: writes a note-like decision object on a Run; nothing is deleted, published or sent. " + 'Set (or clear with null) a Run’s decision. Arbitrary JSON object; chimera does not validate its shape.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: setDecisionInputSchema,
    },
    async ({ run_id, decision }) => {
      const run = await getRunOr404(db, run_id);
      const updated = await updateExperimentRun(db, run, { decision });
      return jsonResult(mcpOutputs.set_decision, serializeExperimentRun(updated));
    },
  );

  server.registerTool(
    'create_request',
    {
      outputSchema: mcpOutputs.create_request,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a requests row for the worker (docs/worker-protocol.md). kind is "generate" (a request.json v1 payload, ' +
        'schema_version/request/generation required), "redraw" (payload {generation_id, options}; options.method is ' +
        'canvas, hires or light), "deliver" (payload {generation_id, options?, profile?}), "dof" ' +
        '(payload {generation_id, options: {focus, ...}}), "lens" (payload {generation_id, options?: {center?, strength?, shape?, radius?}}), "photo" (payload {generation_id, options: {photo, ...}}), "stage" (payload {generation_id, options?: {photo?, place?, height?, backdrop?, shadow_from?, frame?, light?}}), "lighting" (payload {generation_id, options?: {direction?, strength?, scene?}}), "repair" ' +
        '(payload {generation_id, options?}, a masked local redraw of hands/feet), or "masked_redraw" ' +
        '(payload {generation_id, options} with explicit arbitrary regions and a prompt patch). "finalize" can no longer ' +
        'be created. redraw_generation / deliver_generation / dof_generation / lens_generation / photo_generation / stage_generation / lighting_generation are the same requests with a typed input. created_by is ' +
        'forced to "mcp". ' +
        promptPartGuidance('generation.identity_override (a non-empty string) of the generate payload') +
        'Pass a stable idempotency_key: the same key with the same kind/payload replays the original ' +
        'row (created: false); the same key with a different kind/payload is a 409 tool error.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: createRequestInputSchema,
    },
    async ({ kind, payload, recipe_ref, idempotency_key }) => {
      const { row, created } = await createRequest(
        db,
        { kind, payload, recipe_ref, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env), checkPatches: generatePayloadPatches(kind, payload) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.create_request, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'redraw_generation',
    {
      outputSchema: mcpOutputs.redraw_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a redraw request (docs/worker-protocol.md "redraw"): the worker redraws the source picture in exactly ' +
        'one way, chosen by options.method; chain redraw requests for more than one operation. Its output Generations record ' +
        'the source Generation as the one they refine (refines_generation). generation_id accepts a short_id. ' +
        'method "canvas" re-renders the whole canvas: denoise (strength, number or a word from list_catalog\'s ' +
        'recipes[].dials.redraw), size (longest side), route ("latent" or "pixel"), finalizer, upscale ' +
        '(bicubic/nearest-exact/bilinear/lanczos), keep_regions ([x0,y0,x1,y1] fraction rectangles the redraw keeps close ' +
        'to the source, through a feathered mask; omit rather than null) and keep_strength (above 0 and below 1, only ' +
        'with keep_regions). method "hires" re-renders the stored ComfyUI graph at the same seed at a larger size: ' +
        'hires (integer >= 64, the long side in px; the pixel area is that of the standard 1024x1640 canvas at that long ' +
        'side, with the source\'s own aspect ratio) and denoise (above 0 up to 1, default 0.45; 0.35 keeps the composition). ' +
        'method "light" relights the picture: scene ("sunset" | "moon") and from (the direction the light comes from, ' +
        'n/ne/e/se/s/sw/w/nw, default "nw"). Omitted fields resolve to the defaults published in list_catalog\'s ' +
        'recipes[].redraw (defaults per method, and the light scenes and directions). ' +
        'Sources: hires needs an Anima generate output (not an import without a graph, not a repair / masked_redraw / ' +
        'redraw output, not already hires-ed); canvas and light work on any Anima picture, including repair, masked_redraw ' +
        'and redraw outputs. Neither accepts an already delivered picture or a LayerDiffuse-derived one, and a picture ' +
        'from a non-Anima recipe cannot be redrawn. Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: redrawGenerationInputSchema,
    },
    async ({ generation_id, options, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const { row, created } = await createRequest(
        db,
        { kind: 'redraw', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.redraw_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'deliver_generation',
    {
      outputSchema: mcpOutputs.deliver_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a deliver request (docs/worker-protocol.md "deliver"): cuts the figure out of the source picture and ' +
        'finishes it — backdrop, outlines and relight — without redrawing it. Its output ' +
        'Generations record the source Generation as the one they refine (refines_generation). generation_id accepts a ' +
        'short_id and takes a raw or redrawn picture, not an already delivered one; a LayerDiffuse-derived picture cannot be ' +
        'delivered. The cut assets (alpha, depth, cut) are made by the first deliver of a picture and reused by later ' +
        'delivers of it, so re-delivering with another backdrop or outlines is cheap. The delivered Generation carries ' +
        'layer assets (figure, outline, backdrop) that dof_generation blurs. ' +
        'options is optional; an omitted field resolves to the recipe\'s published deliver default — ' +
        'list_catalog\'s recipes[].deliver.defaults is where these are published, the same values the WebUI form presets ' +
        'from, so look them up per-recipe rather than hardcoding (stroke_light "n", backdrop "dots", outlines and repin true across ' +
        'recipes). An explicit null keeps its own meaning rather than falling back to a default. Fields: ' +
        'repin (accent-compression recolor pass), recolor (palette recolor), skin (skin pass), ' +
        'keep_legwear (keep tights/legwear: true for the worker default weight 0.62, a number, or a word from ' +
        'recipes[].dials.deliver), keep_scene (keep background/scene), ' +
        'backdrop (a pattern name — list_catalog\'s top-level backdrops lists what\'s published, e.g. "stripes" — ' +
        'or a #RRGGBB color; null delivers transparent unless transparent is false), ' +
        'transparent (true is the explicit form of an alpha-cut delivery with no backdrop; false keeps a backdrop even ' +
        'when backdrop is null), ' +
        'outlines (array of up to 6 {color: "#rrggbb", width: percent of the long side, 0 < width <= 5}, innermost first; ' +
        'omitted or null = the catalog default, [] = no outline), ' +
        'stroke_light (shading of the outermost outline: n/ne/e/se/s/sw/w/nw is a light direction with a drop shadow on the far side; ' +
        '"even" (null is accepted as the same) is a uniform-width stroke), ' +
        'deliver_size (delivered file\'s longest side), ' +
        'see_through (1-5, default 1: scales how much of the backdrop shows through see-through clothing drawn over ' +
        'the green key — 1 is the cut as solved, 3 lets three times as much through; the stored alpha cut is unchanged), ' +
        'light ({scene: "sunset" | "moon", from?: "n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw"}: the scene and light direction ' +
        'the delivery follows; from is the direction the light comes from, default "nw"). When light is omitted it is inherited from the ' +
        'nearest redraw with method "light" among the source\'s ancestors, and stroke_light follows that direction; a ' +
        'stroke_light direction different from the light\'s from fails, "even" or null combine with it. ' +
        'Every dial-able option (keep_legwear) also accepts a word string instead of a number/true — the word ' +
        'vocabulary for this recipe is list_catalog\'s recipes[].dials.deliver (chimera only checks the type; the worker ' +
        'resolves the word). ' +
        'profile {name, version?} resolves a deliver Preset (list_presets kind="deliver") for the source ' +
        "Generation's recipe (latest active version when version is omitted) and uses its options as the base — " +
        'any key also given in options overrides it, explicit null included. Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: deliverGenerationInputSchema,
    },
    async ({ generation_id, options, profile, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const payload: Record<string, unknown> = { generation_id: generation.short_id };
      if (options) payload.options = options;
      if (profile) payload.profile = profile;
      const { row, created } = await createRequest(
        db,
        { kind: 'deliver', payload, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.deliver_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'dof_generation',
    {
      outputSchema: mcpOutputs.dof_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a dof request (docs/worker-protocol.md "dof"): depth-of-field blur of a delivered picture, made from its ' +
        'layer assets (figure, outline, backdrop). generation_id accepts a short_id and takes only a Generation produced ' +
        'by deliver that has layer assets; a picture delivered before layers existed must be delivered again, and a dof ' +
        'output cannot be blurred again. focus is [x, y], fractions 0-1 of the picture width/height (required). ' +
        'f_number is 1.4-22 (default 2.8), smaller = more blur. scope is {figure?, outline?, backdrop?} booleans naming ' +
        'the layers to blur (default all true, not all false). viewfinder: "off" (default), "on" draws a mirrorless ' +
        'viewfinder overlay (rule-of-thirds grid, a focus frame at focus, a shutter/F-number/ISO bar), "both" outputs the ' +
        'plain image and the overlaid one as two Generations. The output is a delivered picture that refines the source. ' +
        'A stage or lighting output is blurred too: a picture set in a photo blurs by the photo\'s depth like photo_generation, ' +
        'taking stand_at / nearer / tilt / bokeh / focal_length (same meanings and defaults; refused on other pictures) instead of scope. ' +
        "list_catalog's top-level dof section publishes the F-number range and defaults. Follow status with get_request.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: dofGenerationInputSchema,
    },
    async ({ generation_id, focus, f_number, scope, viewfinder, stand_at, nearer, tilt, bokeh, focal_length, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const options: Record<string, unknown> = { focus };
      if (f_number !== undefined) options.f_number = f_number;
      if (scope !== undefined) options.scope = scope;
      if (viewfinder !== undefined) options.viewfinder = viewfinder;
      if (stand_at !== undefined) options.stand_at = stand_at;
      if (nearer !== undefined) options.nearer = nearer;
      if (tilt !== undefined) options.tilt = tilt;
      if (bokeh !== undefined) options.bokeh = bokeh;
      if (focal_length !== undefined) options.focal_length = focal_length;
      const { row, created } = await createRequest(
        db,
        { kind: 'dof', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.dof_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'lens_generation',
    {
      outputSchema: mcpOutputs.lens_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a lens request (docs/worker-protocol.md "lens"): bend a delivered picture through a fisheye or its ' +
        'inverse, outline bands and backdrop with it. generation_id accepts a short_id and takes a delivered picture: a ' +
        'deliver output, a dof output without the viewfinder overlay, or another lens output (lenses stack). Blur first: ' +
        'a lens output cannot be given a dof. strength is -1 to 1 (default 0.7, not 0): positive is a fisheye that swells ' +
        'what sits at center and squeezes the rim (the farthest corner stays put; strength 1 is a 75° half angle there), ' +
        'negative is the exact inverse that shrinks center and stretches the rim, zoomed in just enough to keep the frame ' +
        'full. center is [x, y], fractions 0-1 of the picture width/height (default [0.5, 0.5]); put it on the feet to ' +
        'push the legs toward the viewer. shape "fisheye" (default) bends the whole frame as above; shape "sphere" is a ' +
        'spherize filter that bends only the disc of radius (0.05-1 of the shorter side, default 0.3; only with sphere) ' +
        'around center, bulging it like a ball (strength > 0) or pinching it (< 0), and leaves the rest untouched. ' +
        'The output is a delivered picture that refines the source. ' +
        "list_catalog's top-level lens section publishes the range and defaults. Follow status with get_request.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: lensGenerationInputSchema,
    },
    async ({ generation_id, center, strength, shape, radius, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const options: Record<string, unknown> = {};
      if (center !== undefined) options.center = center;
      if (strength !== undefined) options.strength = strength;
      if (shape !== undefined) options.shape = shape;
      if (radius !== undefined) options.radius = radius;
      const { row, created } = await createRequest(
        db,
        { kind: 'lens', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.lens_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'photo_generation',
    {
      outputSchema: mcpOutputs.photo_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a photo request (docs/worker-protocol.md "photo"): stand a delivered picture\'s figure and outline bands, ' +
        'one flat card like an acrylic stand, inside a photo and blur the scene by depth. generation_id accepts a short_id and ' +
        'takes a deliver output with layer assets (its backdrop is replaced). photo is the Generation (id or short_id) whose ' +
        'image is the scene, usually one uploaded on the /photos page (required). place is [x, y] of the photo where the middle ' +
        "of the card's bottom edge goes (default [0.5, 0.95]; y up to 1.5 puts the base below the frame, cropping the feet so the card can be larger); height is the card's height as a share of the photo's " +
        '(0.05-1.5, default 0.7). The card stands at one depth: the photo\'s depth at stand_at ([x, y], e.g. a signboard to ' +
        "share its focus; null = the card's own base, default), pulled toward the camera by nearer (0-1 of the scene depth, " +
        'default 0). tilt (-1 to 1, default 0) leans the card, its top that much farther than its base, so a focus on the ' +
        'face ([x, y] on it) blurs the body below. focus is "subject" (the card, its middle when tilted; default) or [x, y] ' +
        'of the picture; f_number is 1.4-22 (default 2.8). bokeh (0-1, default 0) opens the photo\'s out-of-focus ' +
        'highlights (street lamps at night) into bright discs. focal_length names the full-frame lens the photo is shot ' +
        'through (list_catalog photo.focal_length values, default "85mm"): the card stands for a 1.5 m figure, so a ' +
        'closer-up card (larger height) or a longer lens blurs the scene more. ' +
        'Coordinates are fractions 0-1 of the photo width/height, and the output has the photo\'s size. The photo\'s depth ' +
        'is built on first use and kept on the photo. The output is a delivered picture that refines the source; ' +
        "lens_generation may follow. list_catalog's top-level photo section publishes the defaults. Follow status with get_request.",
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: photoGenerationInputSchema,
    },
    async ({ generation_id, photo, place, height, stand_at, nearer, focus, f_number, tilt, bokeh, focal_length, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const scene = await resolveGenerationOr404(db, photo);
      const options: Record<string, unknown> = { photo: scene.short_id };
      if (place !== undefined) options.place = place;
      if (height !== undefined) options.height = height;
      if (stand_at !== undefined) options.stand_at = stand_at;
      if (nearer !== undefined) options.nearer = nearer;
      if (focus !== undefined) options.focus = focus;
      if (f_number !== undefined) options.f_number = f_number;
      if (tilt !== undefined) options.tilt = tilt;
      if (bokeh !== undefined) options.bokeh = bokeh;
      if (focal_length !== undefined) options.focal_length = focal_length;
      const { row, created } = await createRequest(
        db,
        { kind: 'photo', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.photo_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'stage_generation',
    {
      outputSchema: mcpOutputs.stage_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a stage request (docs/worker-protocol.md "stage"): set a delivered picture\'s figure and outline layers on a ' +
        'backdrop of their own, unblurred, keeping the layers for lighting_generation and dof_generation after. generation_id ' +
        'accepts a short_id and takes a deliver output with layer assets, usually a transparent one. With photo (a Generation ' +
        "id or short_id, usually uploaded on /photos) the card goes into the photo: place is [x, y] where the middle of its " +
        'bottom edge goes (default [0.5, 0.95], y up to 1.5 crops the feet) and height its share of the photo height ' +
        '(0.05-1.5, default 0.7); the output has the photo\'s size. Without photo it stays at its canvas on backdrop (a ' +
        "list_catalog backdrops pattern name or #RRGGBB, default the deliver default) with a drop shadow thrown away from " +
        'shadow_from (n/ne/e/se/s/sw/w/nw; null for none; omitted takes the delivery\'s own light, else the scene\'s), tinted to ' +
        'light ({scene: "sunset" | "moon", from?}; omitted inherits the nearest light redraw in the lineage, null for none) as a ' +
        'delivery in that scene. frame ({box: [x0, y0, x1, y1] as fractions of the picture\'s canvas, sides?: {top, right, bottom, left: "cut" | "out" | "behind"}, line?: {color?, width?} | null, rim?: {color?, width?} | null (a dark edge on both sides of the line, on by default), paper?, canvas?, expand? (false keeps the automatic canvas within the delivered picture), strokes?}) puts the figure in a box of the backdrop: a "cut" side crops the figure at the box edge an "out" side lets it pop out over the frame, and a "behind" side lets it pass under the frame band (default top out, others cut); strokes erase or restore the figure with a brush. frame belongs to the backdrop set and is not for photo. ' +
        'The two sets do not mix. ' +
        'The output is a delivered picture that refines the source. Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: stageGenerationInputSchema,
    },
    async ({ generation_id, photo, place, height, backdrop, shadow_from, frame, light, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const options: Record<string, unknown> = {};
      if (photo !== undefined) options.photo = (await resolveGenerationOr404(db, photo)).short_id;
      if (place !== undefined) options.place = place;
      if (height !== undefined) options.height = height;
      if (backdrop !== undefined) options.backdrop = backdrop;
      if (shadow_from !== undefined) options.shadow_from = shadow_from;
      if (frame !== undefined) options.frame = frame;
      if (light !== undefined) options.light = light;
      const { row, created } = await createRequest(
        db,
        { kind: 'stage', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.stage_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'lighting_generation',
    {
      outputSchema: mcpOutputs.lighting_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a lighting request (docs/worker-protocol.md "lighting"): light a staged picture\'s figure and outline by its ' +
        'backdrop so they stop floating: exposure and colour cast pulled toward the ambient around the card, and with ' +
        'direction (n/ne/e/se/s/sw/w/nw; null = none, default) shading from that side tinted by the backdrop\'s brightest light. ' +
        'strength is 0-1 (default 0.7). scene ("sunset" | "moon"; null = none, default) lights the figure as that scene\'s light ' +
        'redraw does (direction default nw) and tints a pattern backdrop to it; a photo backdrop is never changed. generation_id accepts a short_id and takes a stage output (or a delivery with its ' +
        'backdrop); a lighting output is refused (light the stage output again). The backdrop is unchanged. The output is a ' +
        'delivered picture that refines the source; dof_generation may follow. Follow status with get_request.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: lightingGenerationInputSchema,
    },
    async ({ generation_id, direction, strength, scene, idempotency_key }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const options: Record<string, unknown> = {};
      if (direction !== undefined) options.direction = direction;
      if (strength !== undefined) options.strength = strength;
      if (scene !== undefined) options.scene = scene;
      const { row, created } = await createRequest(
        db,
        { kind: 'lighting', payload: { generation_id: generation.short_id, options }, idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.lighting_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'repair_generation',
    {
      outputSchema: mcpOutputs.repair_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a repair request (docs/worker-protocol.md "repair"): a masked local redraw of hands and/or feet ' +
        'on a raw or redrawn Generation; its output Generations record the source Generation as the one they refine, the ' +
        'same lineage shape as redraw. generation_id accepts a short_id and cannot be an already delivered Generation. ' +
        "options is optional; every field defaults to the worker/recipe " +
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
      return jsonResult(mcpOutputs.repair_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'masked_redraw_generation',
    {
      outputSchema: mcpOutputs.masked_redraw_generation,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. " +
        'Enqueue a generic masked redraw / garment inpaint request (docs/worker-protocol.md "masked_redraw"): ' +
        'the source Generation is left unchanged and the worker creates new Generations that record it as the one they refine. ' +
        'generation_id accepts a short_id. options requires one or more non-overlapping ' +
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
      return jsonResult(mcpOutputs.masked_redraw_generation, { created, request: serializeRequest(row) });
    },
  );

  server.registerTool(
    'get_request',
    {
      outputSchema: mcpOutputs.get_request,
      description:
        'Get a requests row by id, including its payload and (once done/failed) result/error. ' +
        'Prompt bodies (prompt overrides, prompt patches) in the payload are folded to a length marker by default; ' +
        'pass include_prompts: true only when you actually need the text.',
      inputSchema: getRequestInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id, include_prompts }) => {
      const row = await getRequestOr404(db, id);
      const serialized = serializeRequest(row);
      const payload = include_prompts ? serialized.payload : foldRequestPayloadPrompts(serialized.payload);
      return jsonResult(mcpOutputs.get_request, { ...serialized, payload });
    },
  );

  server.registerTool(
    'list_requests',
    {
      outputSchema: mcpOutputs.list_requests,
      description:
        'List requests rows, optionally filtered by status, kind, or run_id. Read-only; does not claim. ' +
        'Prompt bodies (prompt overrides, prompt patches) in each payload are folded to a length marker by default; ' +
        'pass include_prompts: true only when you actually need the text.',
      inputSchema: listRequestsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ status, kind, run_id, include_prompts }) => {
      const rows = await listRequests(db, { status, kind, run_id }, 200, 0);
      const items = rows.map((row) => {
        const serialized = serializeRequest(row);
        const payload = include_prompts ? serialized.payload : foldRequestPayloadPrompts(serialized.payload);
        return { ...serialized, payload };
      });
      return jsonResult(mcpOutputs.list_requests, { items });
    },
  );

  server.registerTool(
    'list_generations',
    {
      outputSchema: mcpOutputs.list_generations,
      description:
        'Find a Generation to start from when you do not already have a short_id — every other Generation tool ' +
        '(get_generation, get_generation_lineage, get_generation_image, redraw_generation, deliver_generation, repair_generation, ' +
        "masked_redraw_generation, derive_request) assumes you already have one. Filters mirror the gallery's own " +
        'filters (character, tag, rating, bookmark, created_at range) and combine freely; published=true is the ' +
        "delivered-look index — every look that was posted, each still carrying its look:<pose> tag; reference=true " +
        "is the pose basis-render index — every Generation currently pinned via set_pose_reference. rating is " +
        "written by the human only, never by an agent — read it as the human's verdict on the image, not something " +
        'to set. Results are newest-first (created_at desc), paginated via limit/offset (limit caps at 200, ' +
        'defaults to 50). Pick a short_id from the results and follow up with get_generation / ' +
        'get_generation_lineage / get_generation_image.',
      inputSchema: listGenerationsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ tag, published, reference, rating, bookmark, character, from, to, limit, offset }) => {
      const query: Record<string, string | undefined> = {
        tag,
        rating,
        character,
        from,
        to,
        published: published === undefined ? undefined : published ? 'true' : 'false',
        reference: reference === undefined ? undefined : reference ? 'true' : 'false',
        bookmark: bookmark === undefined ? undefined : bookmark ? 'true' : 'false',
        limit: limit === undefined ? undefined : String(limit),
        offset: offset === undefined ? undefined : String(offset),
      };
      const { items, total } = await queryGenerations(db, query, origin);
      return jsonResult(mcpOutputs.list_generations, {
        items: items.map((item) => ({
          short_id: item.short_id,
          rating: item.rating,
          bookmark: item.bookmark,
          tags: item.tags,
          published: item.published,
          safety: item.safety,
          reference: item.reference,
          summary: item.summary,
          character: item.character,
          created_at: item.created_at,
          request_id: item.request_id,
          canonical_url: item.canonical_url,
        })),
        total,
      });
    },
  );

  server.registerTool(
    'get_generation',
    {
      outputSchema: mcpOutputs.get_generation,
      description:
        'Get a Generation (by id or short_id) with its request, comfy_job (graph/render_facts) and reference links — same shape as GET /api/v1/generations/{id}. ' +
        'request is the generation request this Generation belongs to: {id, short_id, kind, recipe, raw_instruction, prompt, ' +
        'negative_prompt, parameters, patches, preset_versions, git_commit, git_dirty, drawn_pose}; prompt and negative_prompt ' +
        "come from the request's first job. siblings lists the other Generations of the same request " +
        '({id, short_id, image_width, image_height, comfy_output_index}). ' +
        "request.drawn_pose is {recipe, pose, reference}: the pose this Generation drew and that pose's current basis-render pin " +
        '(same shape as get_catalog_pose reference, null if unpinned); null when the request names no pose. pose_reference, by ' +
        'contrast, says whether this Generation is itself a pin. ' +
        'comfy_job.prompt_not_reusable is non-null for repair and masked_redraw outputs (and older repair-carrying finalize outputs): their ' +
        'render_facts prompts were cut for a masked region (face, hair and hood tags dropped), so never pass them as a ' +
        'generate prompt — use derive_request from the Generation instead. ' +
        'Prompt bodies (request prompt/negative_prompt/parameters.prompt_patch/prompt patches, render_facts sampler prompts, the ComfyUI graph) are folded to a ' +
        'length marker by default (the graph becomes null with comfy_job.graph_omitted: true); pass include_prompts: true ' +
        'only when you actually need the text.',
      inputSchema: getGenerationInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ generation_id, include_prompts }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      const detail = await getGenerationDetail(db, origin, generation);
      return jsonResult(mcpOutputs.get_generation, include_prompts ? detail : foldGenerationDetailPrompts(detail));
    },
  );

  server.registerTool(
    'get_generation_lineage',
    {
      outputSchema: mcpOutputs.get_generation_lineage,
      description:
        'Walk a Generation\'s request lineage: ancestors (material requests it referenced, and the request it was refined from) ' +
        'and descendants (requests that referenced or were refined from it), each annotated with how they connect ' +
        "(via 'reference' with the reference purpose, or 'refinement' with the refining request's kind) and its own Generations " +
        '(short_id/rating/semantic_summary). depth defaults to 5, capped at 10.',
      inputSchema: generationLineageInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ generation_id, depth }) => {
      const generation = await resolveGenerationOr404(db, generation_id);
      return jsonResult(mcpOutputs.get_generation_lineage, await getGenerationLineage(db, generation, depth));
    },
  );

  server.registerTool(
    'derive_request',
    {
      outputSchema: mcpOutputs.derive_request,
      description:
        "Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never deletes, overwrites, publishes or sends anything, and never modifies the parent Generation. Idempotent by idempotency_key. " +
        'Enqueue a generate request derived from an existing Generation: carries the parent request\'s recipe/parameters/patches ' +
        'forward, merging `parameters` over the parent\'s and appending (or, with replace_patches, replacing) `patches`. ' +
        'If from_generation_id is a redrawn, delivered or repaired Generation, it is resolved back to the raw Generation it was made ' +
        'from before deriving (redraw/deliver/repair payloads are not generate parameters). ' +
        '404s if from_generation_id does not resolve; 409s if the resolved source request has no single recipe (graph-mode) ' +
        'or if a refinement in the chain has no source generation to resolve through; ' +
        'or if the source request carries patches but no pinned preset version on a recipe that has presets — pass ' +
        'replace_patches: true (with patches restated against the current preset) or derive from a pinned request instead. ' +
        'seeds, if given, must have exactly `count` entries. reference is recorded as a purpose="derive" Reference back to the ' +
        'resolved source Generation (plus a second purpose="derive" aspect="delivered" reference to the requested Generation ' +
        'when it differs from the source). ' +
        promptPartGuidance('identity_override (written to generation.identity_override; not carried from the parent)') +
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
      const { generation: sourceGeneration, request: sourceRequest } = await resolveDerivationSource(db, requestedGeneration);

      const parentPatches = parseJsonArray(sourceRequest.patches_json);
      const parentPresets = parseJsonArray(sourceRequest.preset_versions_json) as { kind: string; name: string; version: number }[];
      const parentRecipeHasPresets = sourceRequest.recipe ? await recipeHasPresets(db, sourceRequest.recipe) : false;

      const payload = buildDerivedRequestPayload({
        parentGenerationId: sourceGeneration.id,
        requestedGenerationId: requestedGeneration.id,
        parentRecipe: sourceRequest.recipe,
        parentParameters: parseJsonObjectOrNull(sourceRequest.parameters_json) ?? {},
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
        // 検査するのはこの呼び出しで渡された patches だけで、親から引き継ぐ分は含めない。
        { defaultRecipeRef: defaultRecipeRef(env), checkPatches: { patches, basePath: ['patches'] } },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.derive_request, {
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
      outputSchema: mcpOutputs.list_catalog,
      description:
        'Get the published recipe catalog summary for recipe_ref (default "production"): recipe names with their ' +
        'pose/costume/expression NAMES, prompt part names (`parts`, the <part> of a "prompt.positive.<part>" patch target) ' +
        'and `identity_tags` (the tags a request must not drop without generation.identity_override) where the recipe ' +
        'has them, per-recipe parameters, the patches vocabulary, `dials` (word -> number maps for redraw/deliver/repair ' +
        'dial-able options, keyed by the option name — the word vocabulary redraw_generation/deliver_generation/repair_generation accept ' +
        'in place of a number), `deliver` (defaults, outlines, stroke_light, backdrop_color: what deliver_generation resolves ' +
        'omitted options to), the top-level `dof` section (F-number range, scope and viewfinder defaults), the top-level `lens` section (strength range and default, center default, shape choices, sphere radius range), the top-level `photo` section (placement, height, stand, nearer, focus, F-number and focal_length defaults) and `redraw` (light scenes and directions, per-method defaults), the top-level `backdrops` ' +
        'name/label list (deliver_generation\'s backdrop pattern ' +
        'choices; omitted when the catalog has none), and git info. No prompt bodies — use get_catalog_pose for a ' +
        'single pose\'s full record.',
      inputSchema: listCatalogInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      return jsonResult(mcpOutputs.list_catalog, {
        recipe_ref: found.row.recipe_ref,
        published_at: found.row.published_at,
        updated_at: found.row.updated_at,
        ...summarizeCatalog(found.doc),
      });
    },
  );

  server.registerTool(
    'get_gpu_status',
    {
      outputSchema: mcpOutputs.get_gpu_status,
      description:
        'Report the power state of the GPU machine whose worker claims queued requests: ' +
        'online / going_to_sleep / sleeping / offline / waking, with since, reason and last_seen. ' +
        'The machine sleeps after 10 idle minutes and every tool that queues a request wakes it (about 10 s from sleep), ' +
        'so a sleeping or waking state only means queued requests start a little later. ' +
        'state is null and error says why when the status could not be read.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const result = await getGpuStatus(env);
      return jsonResult(
        mcpOutputs.get_gpu_status,
        result.ok
          ? { ...result.status, error: null }
          : { state: null, since: null, reason: null, last_seen: null, error: result.error },
      );
    },
  );

  server.registerTool(
    'get_catalog_pose',
    {
      outputSchema: mcpOutputs.get_catalog_pose,
      description:
        'Get a single pose record (full body, prompts included) from the published catalog for recipe_ref (default "production"). ' +
        'Where the recipe splits its prompt into parts, `parts` is [{name, text}] in order (the texts concatenate to the ' +
        'positive prompt); patch one of them with target "prompt.positive.<name>" instead of replacing the whole prompt. ' +
        'reference is the pose\'s current basis-render pin (set_pose_reference), or null if none has been set.',
      inputSchema: getCatalogPoseInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, pose, recipe_ref }) => {
      const found = await getCatalog(db, recipe_ref);
      if (!found) throw notFound(`recipe catalog '${recipe_ref}'`);
      const record = findCatalogPose(found.doc, recipe, pose);
      if (!record) throw notFound(`pose '${pose}' in recipe '${recipe}'`);
      const reference = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
      // catalog は本文を持たない pose を裸の名前文字列で書ける。structuredContent は object 必須なのでここで {name} に揃える。
      const recordObject = typeof record === 'string' ? { name: record } : (record as Record<string, unknown>);
      return jsonResult(mcpOutputs.get_catalog_pose, { ...recordObject, reference });
    },
  );

  server.registerTool(
    'list_presets',
    {
      outputSchema: mcpOutputs.list_presets,
      description:
        'List Presets (pose/costume/expression/deliver), one row per name at its latest version — no record body. ' +
        "Unlike list_catalog/get_catalog_pose, which read the chagama catalog snapshot, Presets are " +
        "chimera's own versioned source of truth for prompt bodies (docs/domain-model.md#preset). Defaults to " +
        'status=active only; include_deprecated also surfaces names whose latest version has been deprecated.',
      inputSchema: listPresetsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, include_deprecated }) => {
      const items = await attachReferences(db, await listPresets(db, { recipe, kind, includeDeprecated: include_deprecated }), {
        recipe,
        kind,
      });
      return jsonResult(mcpOutputs.list_presets, { items });
    },
  );

  server.registerTool(
    'get_preset',
    {
      outputSchema: mcpOutputs.get_preset,
      description:
        'Get a Preset resolved to its full body: record plus, for a promoted version, the patches accumulated ' +
        "from its base chain (oldest first). version defaults to the name's latest active version; an explicit " +
        'version can still be read once deprecated. Presets are chimera\'s own versioned source of truth for ' +
        'prompt bodies (docs/domain-model.md#preset) — unlike get_catalog_pose, which reads a chagama snapshot. ' +
        'kind "deliver" is a different shape: record is {options} (a deliver_generation options object, words ' +
        'preserved) and patches is always [] — it has no base chain.',
      inputSchema: getPresetInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ recipe, kind, name, version }) => {
      const row = await getPresetRow(db, recipe, kind, name, version);
      if (!row) throw notFound(`preset '${recipe}/${kind}/${name}'`);
      const resolved = await resolvePreset(db, row);
      const reference = await referenceView(db, await getCurrentReference(db, row.recipe, row.kind, row.name));
      return jsonResult(mcpOutputs.get_preset, { ...serializeResolvedPreset(row, resolved), reference });
    },
  );

  server.registerTool(
    'promote_to_pose',
    {
      outputSchema: mcpOutputs.promote_to_pose,
      description:
        'Non-destructive: only appends one new Preset version. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Turn a rating=good Generation into a new Preset version (docs/worker-protocol.md「preset の移行」段階 B). ' +
        'Never rewrites an existing version — always appends the next version of (recipe, kind, name); pass an ' +
        'existing name for a new version of it, or a new name to start it at version 1. base is the preset version ' +
        'the originating generate request pinned (generation.presets); if that request predates pinning and carries ' +
        'no pin, pass base_version explicitly — chimera never guesses a base. kind defaults to "pose". If ' +
        'generation_id is a redrawn/delivered/repaired Generation, it is resolved back to the raw Generation the same way ' +
        'derive_request does, and recipe/base/patches are taken from there — but rating is read from generation_id ' +
        'itself. 409s when rating is not good, when the resolved source request has no recipe (graph-mode), or when ' +
        'neither a pin nor base_version is available. idempotency_key replay returns the already-created version ' +
        'unchanged.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: presetPromoteRequestSchema,
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
      const reference = await referenceView(db, await getCurrentReference(db, result.recipe, result.kind, result.name));
      return jsonResult(mcpOutputs.promote_to_pose, { ...result, reference });
    },
  );

  server.registerTool(
    'set_pose_reference',
    {
      outputSchema: mcpOutputs.set_pose_reference,
      description:
        'Non-destructive: only appends one new preset_references row. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Pins generation_id as the basis render for recipe/pose — the render plain_render reproduces (at its seed) as the ' +
        "pose's recipe-default look. The pin belongs to the (recipe, pose) name, not a version: a Preset version carries " +
        'patches, the pin says which render is the baseline the pose should look like. ' +
        'generation_id must carry rating=good. If it is a redrawn/delivered/repaired Generation, it is resolved back to the raw ' +
        'Generation the same way derive_request does — but rating is read from generation_id itself. The resolved request ' +
        'must then be a *plain render* of recipe/pose: same recipe, drew this pose, no patches, and the queued generate ' +
        'request (when one exists) did not override prompt/negative_prompt — every failing rule is named in one 409, not ' +
        'just the first. 404s when recipe/pose has no Preset yet, or generation_id does not resolve. 409s when rating is ' +
        "not good, the resolved request isn't a plain render, or the resolved Generation has no recorded seed. " +
        'Re-setting supersedes the previous pin rather than replacing it in place — every pin ever set stays in the ' +
        'history (superseded_at), never deleted; the response returns it as superseded. idempotency_key replay with the ' +
        'same recipe/pose/generation_id returns the existing pin (created: false, superseded: null); reused with ' +
        'different arguments, 409s.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: setPoseReferenceInputSchema,
    },
    async ({ recipe, pose, generation_id, idempotency_key }) => {
      const result = await setPoseReference(db, { recipe, pose, generation_id, idempotency_key, created_by: 'mcp' });
      return jsonResult(mcpOutputs.set_pose_reference, result);
    },
  );

  server.registerTool(
    'plain_render',
    {
      outputSchema: mcpOutputs.plain_render,
      description:
        'Non-destructive: only appends one new queued draft row to the requests table for the worker to pick up. Never ' +
        'deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Enqueues one kind=generate request that renders recipe/pose at the recipe\'s defaults — no patches — at the seed ' +
        "set_pose_reference last pinned for that pose, or at seed when given (also how a pose that has no pin yet gets " +
        'bootstrapped). Works for promoted poses too — the pose must exist as a Preset (list_presets), not in the ' +
        'catalog. 404s when recipe/pose has no Preset, or when the recipe_ref catalog (default "production") is not ' +
        'published. 409s when neither a pin nor seed is available. ' +
        'Default idempotency_key is `plain:<recipe>:<pose>:<seed>:<catalog git_commit>`, so repeated calls at the same ' +
        'catalog commit replay (created: false) instead of duplicating; pass an explicit one to force a fresh request at ' +
        'the same seed and catalog.',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: plainRenderInputSchema,
    },
    async ({ recipe, pose, seed, idempotency_key, recipe_ref }) => {
      const resolvedRecipeRef = recipe_ref ?? defaultRecipeRef(env);
      const built = await buildPlainRenderRequest(db, { recipe, pose, seed, idempotency_key, recipe_ref: resolvedRecipeRef });
      const { row, created } = await createRequest(
        db,
        { kind: 'generate', payload: built.payload, recipe_ref: resolvedRecipeRef, idempotency_key: built.idempotency_key, created_by: 'mcp' },
        { defaultRecipeRef: defaultRecipeRef(env) },
      );
      if (created) notifyHubInBackground(env, 'queued', row);
      return jsonResult(mcpOutputs.plain_render, {
        created,
        request: serializeRequest(row),
        payload: built.payload,
        seed: built.seed,
        reference: built.reference,
      });
    },
  );

  server.registerTool(
    'promote_to_profile',
    {
      outputSchema: mcpOutputs.promote_to_profile,
      description:
        'Non-destructive: only appends one new Preset version. Never deletes, overwrites, publishes or sends anything. Idempotent by idempotency_key. ' +
        'Turn a rating=good deliver-kind Generation into a new kind="deliver" Preset version (a reusable profile of ' +
        'deliver options, docs/worker-protocol.md「deliver profile」). generation_id must be a Generation produced by a ' +
        'deliver request (any of its output Generations) — found via the deliver request whose result includes this ' +
        'Generation. 409s when rating is not good or when generation_id was not produced by a deliver request. The new ' +
        'version\'s body is that request\'s queued options verbatim (dial words preserved). Never rewrites an existing ' +
        'version — pass an existing name for a new version of it, or a new name to start it at version 1. ' +
        'idempotency_key replay returns the already-created version unchanged. Use the result with ' +
        'deliver_generation\'s profile input or list_presets kind="deliver".',
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: presetPromoteProfileRequestSchema,
    },
    async ({ generation_id, name, note, idempotency_key }) => {
      const result = await promoteGenerationToProfile(db, { generation_id, name, note, idempotency_key, created_by: 'mcp' });
      const reference = await referenceView(db, await getCurrentReference(db, result.recipe, result.kind, result.name));
      return jsonResult(mcpOutputs.promote_to_profile, { ...result, reference });
    },
  );

  server.registerTool(
    'list_observations',
    {
      outputSchema: mcpOutputs.list_observations,
      description:
        "List Observations, chimera's index of chagama' experiments/ records (docs/domain-model.md#observation). " +
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
      return jsonResult(mcpOutputs.list_observations, { items, total });
    },
  );

  server.registerTool(
    'get_observation',
    {
      outputSchema: mcpOutputs.get_observation,
      description: 'Get one Observation by id (docs/domain-model.md#observation). 404s (as a tool error) when not found.',
      inputSchema: idInputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const row = await getObservation(db, id);
      if (!row) throw notFound('observation');
      return jsonResult(mcpOutputs.get_observation, row);
    },
  );

  server.registerTool(
    'record_observation',
    {
      outputSchema: mcpOutputs.record_observation,
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
      return jsonResult(mcpOutputs.record_observation, row);
    },
  );

  server.registerTool(
    'record_publication',
    {
      outputSchema: mcpOutputs.record_publication,
      description:
        'Non-destructive: only records that a Generation was posted (docs/domain-model.md#publication). Never deletes, ' +
        'overwrites, or sends anything — it does not post to X itself, it just records that a posting happened. The response carries `warning` (non-null when the Generation content-rating verdict is block or sensitive; the posting is still recorded, never rejected). url is ' +
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
      const warning = await publishWarningFor(db, generation.id);
      return jsonResult(mcpOutputs.record_publication, { ...serializePublication(row), warning });
    },
  );

  return server;
}
