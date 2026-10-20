// 絵柄チェック (docs/ui.md「絵柄チェック」): recipe の全ポーズについて pin と今のカタログのずれ (ドリフト) を並べ、
// 人間が見比べる。生成は plain_render (lib/plain-render.ts) と同じ経路 — このファイルは「どのポーズを並べるか」
// の導出と、既存 request を探す/積むだけの薄い層。

import { buildPlainRenderRequest } from './plain-render';
import { findCatalogPose, getCatalog } from './catalogs';
import { getPresetRow, listPresets } from './presets';
import { stableStringify } from './json-canonical';
import { createRequest, defaultRecipeRef, resolveDerivationSource } from './requests';
import { getCurrentReference, referenceView, type PresetReferenceView } from './preset-references';
import { getGenerationByIdOrShortId } from './db';
import { runOverridePose } from './experiment-rules';
import { getExperimentOr404, listRuns } from './experiments';
import { notFound } from './errors';
import { parseJsonObjectOrNull } from './overrides';
import { diffFactSummaries, renderFactsForJob, type FactDiffEntry } from './render-facts';
import type { ComfyJobRow, RequestRow } from '../types';

/** /check が対象にする recipe。今は yukari だけ (docs/ui.md「絵柄チェック」)。 */
export const STYLE_CHECK_RECIPE = 'yukari';

/** カタログの pose 名 + Preset だけに存在する pose (昇格した pose。lib/plain-render.ts) の和集合を名前順に。 */
export async function listStyleCheckPoseNames(db: D1Database, recipe: string, recipeRef: string): Promise<string[]> {
  const names = new Set<string>();
  const catalog = await getCatalog(db, recipeRef);
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

/**
 * 絵柄チェックの idempotency key: `style-check:<recipe>:<pose>:<sha256>`。ハッシュの入力は plain render が
 * 描く内容だけ — pin の seed、pose の preset (版と本文)、カタログ上の pose レコード (prompt / negative / canvas など)、
 * recipe 直下の pose 以外の定義 (parameters / costumes / expressions / parts / model など。`poses` と、描画に関わらない
 * `dials` / `redraw` / `deliver` (古い `finalize` も) は除く)。
 * git_commit・generated_at・patches・backdrops は入れないので、docs や納品の既定だけの変更では key が変わらない。
 */
export async function styleCheckIdempotencyKey(
  db: D1Database,
  recipeRef: string,
  recipe: string,
  pose: string,
  seed: number,
): Promise<string> {
  const catalog = await getCatalog(db, recipeRef);
  const recipeEntry = catalog?.doc.recipes.find((r) => r.name === recipe) as Record<string, unknown> | undefined;
  const { poses: _poses, dials: _dials, redraw: _redraw, deliver: _deliver, finalize: _finalize, ...recipeLevel } = recipeEntry ?? {};
  const preset = await getPresetRow(db, recipe, 'pose', pose);
  const content = {
    recipe,
    pose,
    seed,
    preset: preset ? { version: preset.version, body: JSON.parse(preset.body_json) as unknown } : null,
    pose_record: catalog ? findCatalogPose(catalog.doc, recipe, pose) : null,
    recipe_level: recipeLevel,
  };
  return `style-check:${recipe}:${pose}:${await sha256Hex(stableStringify(content))}`;
}

export interface StyleCheckRow {
  pose: string;
  /** 現在の pin。無ければこの pose の行は描けない (GET /check「pin なし」)。 */
  pin: PresetReferenceView | null;
  drift: DriftState;
  /** drift のときだけ: pin を描いた実際の prompt (baseline) とカタログの pose の prompt (arm) の差。 */
  prompt_diff: FactDiffEntry[];
  /** pin があるときだけ埋まる、今の描画内容での style-check idempotency key。 */
  idempotency_key: string | null;
  /** その key に一致する既存 request。無ければ「まだ描いていない」。 */
  request: RequestRow | null;
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
): Promise<StyleCheckRow[]> {
  const catalog = await getCatalog(db, recipeRef);
  const rows: StyleCheckRow[] = [];
  for (const pose of await listStyleCheckPoseNames(db, recipe, recipeRef)) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    let idempotencyKey: string | null = null;
    let request: RequestRow | null = null;
    let drift: DriftState = 'no_pin';
    let promptDiff: FactDiffEntry[] = [];
    if (pin) {
      idempotencyKey = await styleCheckIdempotencyKey(db, recipeRef, recipe, pose, pin.seed);
      request = await db.prepare('SELECT * FROM requests WHERE idempotency_key = ?').bind(idempotencyKey).first<RequestRow>();
      const catalogPose = catalog ? findCatalogPose(catalog.doc, recipe, pose) : null;
      ({ drift, diff: promptDiff } = await pinDrift(db, pin, catalogPose));
    }
    rows.push({ pose, pin, drift, prompt_diff: promptDiff, idempotency_key: idempotencyKey, request });
  }
  return rows;
}

export interface StyleCheckRenderResult {
  pose: string;
  skipped?: 'no_pin';
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
 * (buildPlainRenderRequest → createRequest) で kind=generate を積む。default idempotency key なので、
 * 同じ catalog commit への連打は何も作らず既存行を返す (created: false)。pin が無い pose は skip される。
 */
export async function renderStyleCheck(
  db: D1Database,
  env: { REQUESTS_DEFAULT_RECIPE_REF?: string },
  recipe: string,
  onlyPose?: string,
): Promise<RenderStyleCheckResult> {
  const recipeRef = defaultRecipeRef(env);
  const poses = onlyPose ? [onlyPose] : await listStyleCheckPoseNames(db, recipe, recipeRef);
  const results: StyleCheckRenderResult[] = [];
  const createdRequests: RequestRow[] = [];

  for (const pose of poses) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    if (!pin) {
      results.push({ pose, skipped: 'no_pin' });
      continue;
    }

    const key = await styleCheckIdempotencyKey(db, recipeRef, recipe, pose, pin.seed);
    const built = await buildPlainRenderRequest(db, { recipe, pose, recipe_ref: recipeRef, idempotency_key: key });
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
