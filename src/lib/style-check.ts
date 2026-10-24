// 絵柄チェック (docs/ui.md「絵柄チェック」): recipe の全ポーズについて pin と今のカタログのずれ (ドリフト) を並べ、
// 人間が見比べる。生成は plain_render (lib/plain-render.ts) と同じ経路 — このファイルは「どのポーズを並べるか」
// の導出と、既存 request を探す/積むだけの薄い層。

import { buildPlainRenderRequest } from './plain-render';
import { findCatalogPose, getCatalog, type CatalogWithDoc } from './catalogs';
import { getPresetRow, listPresets } from './presets';
import { stableStringify } from './json-canonical';
import { createRequest, defaultRecipeRef, resolveDerivationSource } from './requests';
import { getCurrentReference, referenceView, type PresetReferenceView } from './preset-references';
import { getGenerationByIdOrShortId } from './db';
import { runOverridePose } from './experiment-rules';
import { getExperimentOr404, listRuns } from './experiments';
import { badRequest, notFound } from './errors';
import { parseJsonObjectOrNull } from './overrides';
import { diffFactSummaries, renderFactsForJob, type FactDiffEntry } from './render-facts';
import type { ComfyJobRow, RequestRow } from '../types';

/** /check が対象にする recipe。今は yukari だけ (docs/ui.md「絵柄チェック」)。 */
export const STYLE_CHECK_RECIPE = 'yukari';

/** カタログの pose 名 + Preset だけに存在する pose (昇格した pose。lib/plain-render.ts) の和集合を名前順に。 */
export async function listStyleCheckPoseNames(db: D1Database, recipe: string, catalog: CatalogWithDoc | null): Promise<string[]> {
  const names = new Set<string>();
  const poses = (catalog?.doc.recipes.find((r) => r.name === recipe) as { poses?: unknown[] } | undefined)?.poses ?? [];
  for (const pose of poses) {
    const name = typeof pose === 'string' ? pose : (pose as { name?: unknown } | null)?.name;
    if (typeof name === 'string') names.add(name);
  }
  for (const preset of await listPresets(db, { recipe, kind: 'pose' })) names.add(preset.name);
  return Array.from(names).sort();
}

export type DriftState = 'match' | 'drift' | 'unknown' | 'no_pin';

/** pin の Request と カタログ pose の fingerprint を突き合わせる。どちらかが無ければ判定不可。 */
export function driftState(hasPin: boolean, pinFingerprint: string | null, catalogFingerprint: string | null): DriftState {
  if (!hasPin) return 'no_pin';
  if (!pinFingerprint || !catalogFingerprint) return 'unknown';
  return pinFingerprint === catalogFingerprint ? 'match' : 'drift';
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 1 つのパラメータだけを recipe 既定から変えた描き方。組み合わせは持たない (docs/ui.md「絵柄チェック」)。 */
export type StyleCheckVariant = { angle: string } | { framing: string };

export type StyleCheckAxis = 'angle' | 'framing';

/** recipe の `angles` / `framings` 語彙 (chagama が公開する文字列の配列)。 */
export function styleCheckVocab(catalog: CatalogWithDoc | null, recipe: string): Record<StyleCheckAxis, string[]> {
  const entry = catalog?.doc.recipes.find((r) => r.name === recipe) as { angles?: unknown; framings?: unknown } | undefined;
  const words = (list: unknown) => (Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string') : []);
  return { angle: words(entry?.angles), framing: words(entry?.framings) };
}

export type StyleCheckLabels = Record<StyleCheckAxis, Record<string, string>>;

/** recipe の `angle_labels` / `framing_labels` (語 → 表示ラベル)。無い・文字列でない値は欠落として扱う。 */
export function styleCheckLabels(catalog: CatalogWithDoc | null, recipe: string): StyleCheckLabels {
  const entry = catalog?.doc.recipes.find((r) => r.name === recipe) as { angle_labels?: unknown; framing_labels?: unknown } | undefined;
  const labels = (map: unknown) => {
    const out: Record<string, string> = {};
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      for (const [word, label] of Object.entries(map)) if (typeof label === 'string' && label !== '') out[word] = label;
    }
    return out;
  };
  return { angle: labels(entry?.angle_labels), framing: labels(entry?.framing_labels) };
}

/** カタログ上の pose レコードの `label`。Preset だけの pose などレコードが無いときは null。 */
export function poseLabel(catalog: CatalogWithDoc | null, recipe: string, pose: string): string | null {
  const record = catalog ? findCatalogPose(catalog.doc, recipe, pose) : null;
  const label = record && typeof record === 'object' ? (record as { label?: unknown }).label : null;
  return typeof label === 'string' && label !== '' ? label : null;
}

export function variantOf(axis: StyleCheckAxis, value: string): StyleCheckVariant {
  return axis === 'angle' ? { angle: value } : { framing: value };
}

/** カタログ上の pose レコードの `framing`。この画角の列は pin そのものなので描かない。 */
export function poseOwnFraming(catalog: CatalogWithDoc | null, recipe: string, pose: string): string | null {
  const record = catalog ? findCatalogPose(catalog.doc, recipe, pose) : null;
  const framing = record && typeof record === 'object' ? (record as { framing?: unknown }).framing : null;
  return typeof framing === 'string' ? framing : null;
}

async function styleCheckKeyContent(
  db: D1Database,
  catalog: CatalogWithDoc | null,
  recipe: string,
  pose: string,
  seed: number,
): Promise<Record<string, unknown>> {
  const recipeEntry = catalog?.doc.recipes.find((r) => r.name === recipe) as { model?: unknown } | undefined;
  const poseRecord = (catalog ? findCatalogPose(catalog.doc, recipe, pose) : null) as
    | { positive?: unknown; negative?: unknown; canvas?: unknown }
    | string
    | null;
  const poseObject = poseRecord && typeof poseRecord === 'object' ? poseRecord : null;
  const preset = await getPresetRow(db, recipe, 'pose', pose);
  return {
    recipe,
    pose,
    seed,
    preset: preset ? { version: preset.version, body: JSON.parse(preset.body_json) as unknown } : null,
    pose_record: poseObject ? { positive: poseObject.positive, negative: poseObject.negative, canvas: poseObject.canvas } : null,
    model: recipeEntry?.model ?? null,
  };
}

async function keyFromContent(recipe: string, pose: string, content: Record<string, unknown>, variant?: StyleCheckVariant): Promise<string> {
  // variant 無しは content に `variant` キー自体を足さない — 既定の key を variant 導入前と同じ値に保つため。
  const hashed = variant ? { ...content, variant } : content;
  return `style-check:${recipe}:${pose}:${await sha256Hex(stableStringify(hashed))}`;
}

/**
 * 絵柄チェックの idempotency key: `style-check:<recipe>:<pose>:<sha256>`。ハッシュの入力は plain render が
 * 描く内容だけ — pin の seed、pose の preset (版と本文)、カタログ上の pose レコードの positive / negative / canvas、
 * recipe の model、variant (あるときだけ)。
 * パラメータ語彙 (parameters / angles など) や pose の parts / fingerprint などの付随情報、git_commit・generated_at・
 * patches・backdrops は入れないので、描く絵が変わらないカタログ変更では key が変わらない。
 */
export async function styleCheckIdempotencyKey(
  db: D1Database,
  catalog: CatalogWithDoc | null,
  recipe: string,
  pose: string,
  seed: number,
  variant?: StyleCheckVariant,
): Promise<string> {
  return keyFromContent(recipe, pose, await styleCheckKeyContent(db, catalog, recipe, pose, seed), variant);
}

export interface StyleCheckVariantCell {
  axis: StyleCheckAxis;
  value: string;
  idempotency_key: string;
  request: RequestRow | null;
}

export interface StyleCheckRow {
  pose: string;
  /** カタログの表示ラベル。無ければ null (生の名前で出す)。 */
  label: string | null;
  /** 現在の pin。無ければこの pose の行は描けない (GET /check「pin なし」)。 */
  pin: PresetReferenceView | null;
  drift: DriftState;
  /** drift のときだけ: pin を描いた実際の prompt (baseline) とカタログの pose の prompt (arm) の差。 */
  prompt_diff: FactDiffEntry[];
  /** pin があるときだけ埋まる、今の描画内容での style-check idempotency key。 */
  idempotency_key: string | null;
  /** その key に一致する既存 request。無ければ「まだ描いていない」。 */
  request: RequestRow | null;
  /** カタログ上の pose の画角。画角の行列でこの列は pin そのもので、variants に含めない。 */
  framing: string | null;
  /** pin があるときだけ: angles / framings の語ごとの variant render の key と既存 request。 */
  variants: StyleCheckVariantCell[];
}

async function pinDrift(
  db: D1Database,
  pin: PresetReferenceView,
  catalogPose: unknown,
): Promise<{ drift: DriftState; diff: FactDiffEntry[] }> {
  const generation = await getGenerationByIdOrShortId(db, pin.generation_id);
  if (!generation) return { drift: 'unknown', diff: [] };
  const { generation: raw, request } = await resolveDerivationSource(db, generation);
  const catalogFingerprint = (catalogPose as { fingerprint?: unknown } | null)?.fingerprint;
  const drift = driftState(true, request.pose_fingerprint, typeof catalogFingerprint === 'string' ? catalogFingerprint : null);
  if (drift !== 'drift') return { drift, diff: [] };

  const job = await db.prepare('SELECT * FROM comfy_jobs WHERE id = ?').bind(raw.comfy_job_id).first<ComfyJobRow>();
  const facts = job ? await renderFactsForJob(db, job) : null;
  const baseline: Record<string, string | null> = {};
  const arm: Record<string, string | null> = {};
  for (const key of ['positive', 'negative'] as const) {
    const catalogValue = (catalogPose as Record<string, unknown>)[key];
    if (typeof catalogValue !== 'string') continue;
    baseline[key] = facts?.samplers[0]?.prompt[key] ?? null;
    arm[key] = catalogValue;
  }
  return { drift, diff: diffFactSummaries(baseline, arm) };
}

/**
 * GET /check が描く行データ: pose ごとに現在の pin、ドリフト判定、今の描画内容での plain render
 * request (あれば) を集める。何も積まない — 既存の request を探すだけ (createRequest は呼ばない)。
 */
export async function loadStyleCheckRows(
  db: D1Database,
  recipe: string,
  recipeRef: string,
): Promise<{ rows: StyleCheckRow[]; vocab: Record<StyleCheckAxis, string[]>; labels: StyleCheckLabels }> {
  const catalog = await getCatalog(db, recipeRef);
  const vocab = styleCheckVocab(catalog, recipe);
  const labels = styleCheckLabels(catalog, recipe);
  // pose ごとに数往復の D1 クエリがあり、直列だと pose 数に比例して遅くなるので並列に引く。
  const rows = await Promise.all(
    (await listStyleCheckPoseNames(db, recipe, catalog)).map(async (pose): Promise<StyleCheckRow> => {
      const framing = poseOwnFraming(catalog, recipe, pose);
      const label = poseLabel(catalog, recipe, pose);
      const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
      if (!pin) return { pose, label, pin, drift: 'no_pin', prompt_diff: [], idempotency_key: null, request: null, framing, variants: [] };
      const catalogPose = catalog ? findCatalogPose(catalog.doc, recipe, pose) : null;
      const [content, { drift, diff }] = await Promise.all([
        styleCheckKeyContent(db, catalog, recipe, pose, pin.seed),
        pinDrift(db, pin, catalogPose),
      ]);
      const idempotencyKey = await keyFromContent(recipe, pose, content);
      const cells = (['angle', 'framing'] as const).flatMap((axis) =>
        vocab[axis].filter((value) => !(axis === 'framing' && value === framing)).map((value) => ({ axis, value })),
      );
      const variants = await Promise.all(
        cells.map(async ({ axis, value }) => ({
          axis,
          value,
          idempotency_key: await keyFromContent(recipe, pose, content, variantOf(axis, value)),
          request: null as RequestRow | null,
        })),
      );
      return { pose, label, pin, drift, prompt_diff: diff, idempotency_key: idempotencyKey, request: null, framing, variants };
    }),
  );

  const keys = rows.flatMap((row) => [row.idempotency_key, ...row.variants.map((v) => v.idempotency_key)].filter((k): k is string => k !== null));
  const byKey = new Map<string, RequestRow>();
  if (keys.length > 0) {
    const { results } = await db
      .prepare('SELECT * FROM requests WHERE idempotency_key IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(keys))
      .all<RequestRow>();
    for (const r of results ?? []) if (r.idempotency_key) byKey.set(r.idempotency_key, r);
  }
  for (const row of rows) {
    row.request = row.idempotency_key ? byKey.get(row.idempotency_key) ?? null : null;
    for (const v of row.variants) v.request = byKey.get(v.idempotency_key) ?? null;
  }
  return { rows, vocab, labels };
}

export interface StyleCheckRenderResult {
  pose: string;
  /** own_framing: framing の variant がその pose 自身の画角 — その列は pin そのものなので描かない。 */
  skipped?: 'no_pin' | 'own_framing';
  created?: boolean;
  request_id?: string;
  status?: RequestRow['status'];
}

export interface RenderStyleCheckResult {
  recipe_ref: string;
  results: StyleCheckRenderResult[];
  /** created:true の行だけ — 呼び出し側 (route) が hub notify するため。 */
  createdRequests: RequestRow[];
}

/**
 * POST /api/v1/style-check/{recipe}: pin を持つ全ポーズ (`pose` 指定ならその 1 つ) について、MCP `plain_render` と同じ組み立て
 * (buildPlainRenderRequest → createRequest) で kind=generate を積む。`variant` があれば recipe 既定にその 1 パラメータだけを
 * 足して描く。content key なので、同じ描画内容への連打は何も作らず既存行を返す (created: false)。pin が無い pose は skip される。
 * variant の語がカタログの `angles` / `framings` に無ければ 400。
 */
export async function renderStyleCheck(
  db: D1Database,
  env: { REQUESTS_DEFAULT_RECIPE_REF?: string },
  recipe: string,
  options: { pose?: string; variant?: StyleCheckVariant } = {},
): Promise<RenderStyleCheckResult> {
  const recipeRef = defaultRecipeRef(env);
  const catalog = await getCatalog(db, recipeRef);
  const { variant } = options;
  if (variant) {
    const [axis, value] = 'angle' in variant ? (['angle', variant.angle] as const) : (['framing', variant.framing] as const);
    if (!styleCheckVocab(catalog, recipe)[axis].includes(value)) throw badRequest(`unknown ${axis} '${value}' for ${recipe}`);
  }
  const poses = options.pose ? [options.pose] : await listStyleCheckPoseNames(db, recipe, catalog);
  const results: StyleCheckRenderResult[] = [];
  const createdRequests: RequestRow[] = [];

  for (const pose of poses) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    if (!pin) {
      results.push({ pose, skipped: 'no_pin' });
      continue;
    }
    if (variant && 'framing' in variant && variant.framing === poseOwnFraming(catalog, recipe, pose)) {
      results.push({ pose, skipped: 'own_framing' });
      continue;
    }

    const key = await styleCheckIdempotencyKey(db, catalog, recipe, pose, pin.seed, variant);
    const built = await buildPlainRenderRequest(db, { recipe, pose, parameters: variant, recipe_ref: recipeRef, idempotency_key: key });
    const { row, created } = await createRequest(
      db,
      { kind: 'generate', payload: built.payload, recipe_ref: recipeRef, idempotency_key: built.idempotency_key, created_by: 'gui' },
      { defaultRecipeRef: recipeRef },
    );
    if (created) createdRequests.push(row);
    results.push({ pose, created, request_id: row.id, status: row.status });
  }

  return { recipe_ref: recipeRef, results, createdRequests };
}

export interface PoseSweepView {
  short_id: string;
  name: string;
  /** どの Run も同じ patch 集合を持つので、先頭の Run のものを読み取り専用で見せる。 */
  patches: unknown[];
  /** pose ごとの、その Run の最新の request (generate)。 */
  requests: Map<string, RequestRow>;
}

/**
 * GET /check?sweep=<experiment short_id>: pose sweep (sweep_patch の Experiment) の Run を pose で引く。
 * 何も積まない。pose を持つ Run が 1 つも無い Experiment は sweep ではないので 404。
 */
export async function loadPoseSweep(db: D1Database, idOrShortId: string): Promise<PoseSweepView> {
  const experiment = await getExperimentOr404(db, idOrShortId);
  const runs = (await listRuns(db, experiment.id)).flatMap((run) => {
    const overrides = parseJsonObjectOrNull(run.overrides_json) ?? {};
    const pose = runOverridePose(overrides);
    return pose ? [{ run, pose, overrides }] : [];
  });
  if (runs.length === 0) throw notFound('pose sweep');

  const requests = new Map<string, RequestRow>();
  for (const { run, pose } of runs) {
    const request = await db
      .prepare("SELECT * FROM requests WHERE run_id = ? AND kind = 'generate' ORDER BY created_at DESC, id DESC LIMIT 1")
      .bind(run.id)
      .first<RequestRow>();
    if (request) requests.set(pose, request);
  }
  const patches = runs[0]!.overrides.patches;
  return { short_id: experiment.short_id, name: experiment.name, patches: Array.isArray(patches) ? patches : [], requests };
}
