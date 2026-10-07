// 絵柄チェック (docs/ui.md「絵柄チェック」): 代表ポーズを今のカタログ既定で並べ、pin から絵柄がずれていないか
// 人間が見比べる。生成は plain_render (lib/plain-render.ts) と同じ経路 — このファイルは「どのポーズを並べるか」
// の正本と、既存 request を探す/積むだけの薄い層。

import { buildPlainRenderRequest } from './plain-render';
import { findCatalogPose, getCatalog } from './catalogs';
import { getPresetRow } from './presets';
import { stableStringify } from './json-canonical';
import { createRequest, defaultRecipeRef } from './requests';
import { getCurrentReference, referenceView, type PresetReferenceView } from './preset-references';
import type { RequestRow } from '../types';

export interface StyleCheckPose {
  framing: string;
  pose: string;
}

/** /check が対象にする recipe。今は yukari だけ (docs/ui.md「絵柄チェック」)。 */
export const STYLE_CHECK_RECIPE = 'yukari';

/**
 * recipe ごとの代表ポーズ一覧 — 絵柄チェックの唯一の正本。各 pose は Preset として存在し pin を持っている
 * ことを前提にする (無ければ「pin 無し」表示になり描けない)。
 */
export const STYLE_CHECK_POSES: Record<string, StyleCheckPose[]> = {
  [STYLE_CHECK_RECIPE]: [
    { framing: 'bust', pose: 'bust' },
    { framing: 'cowboy', pose: 'coffee' },
    { framing: 'cowboy', pose: 'gao' },
    { framing: 'full', pose: 'step' },
    { framing: 'full', pose: 'dance' },
    { framing: 'full', pose: 'anyo' },
  ],
};

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
  framing: string;
  pose: string;
  /** 現在の pin。無ければこの pose の行は描けない (GET /check「pin 無し」)。 */
  pin: PresetReferenceView | null;
  /** pin があるときだけ埋まる、今の描画内容での style-check idempotency key。 */
  idempotency_key: string | null;
  /** その key に一致する既存 request。無ければ「まだ描いていない」。 */
  request: RequestRow | null;
}

/**
 * GET /check が描く行データ: pose ごとに現在の pin と、今の描画内容での plain render
 * request (あれば) を集める。何も積まない — 既存の request を探すだけ (createRequest は呼ばない)。
 */
export async function loadStyleCheckRows(
  db: D1Database,
  recipe: string,
  recipeRef: string,
): Promise<StyleCheckRow[]> {
  const poses = STYLE_CHECK_POSES[recipe] ?? [];
  const rows: StyleCheckRow[] = [];
  for (const { framing, pose } of poses) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    let idempotencyKey: string | null = null;
    let request: RequestRow | null = null;
    if (pin) {
      idempotencyKey = await styleCheckIdempotencyKey(db, recipeRef, recipe, pose, pin.seed);
      request = await db.prepare('SELECT * FROM requests WHERE idempotency_key = ?').bind(idempotencyKey).first<RequestRow>();
    }
    rows.push({ framing, pose, pin, idempotency_key: idempotencyKey, request });
  }
  return rows;
}

export interface StyleCheckRenderResult {
  framing: string;
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
 * POST /api/v1/style-check/{recipe}: pin を持つ代表ポーズごとに、MCP `plain_render` と同じ組み立て
 * (buildPlainRenderRequest → createRequest) で kind=generate を積む。default idempotency key なので、
 * 同じ catalog commit への連打は何も作らず既存行を返す (created: false)。pin が無い pose は skip される。
 */
export async function renderStyleCheck(
  db: D1Database,
  env: { REQUESTS_DEFAULT_RECIPE_REF?: string },
  recipe: string,
): Promise<RenderStyleCheckResult> {
  const recipeRef = defaultRecipeRef(env);
  const poses = STYLE_CHECK_POSES[recipe] ?? [];
  const results: StyleCheckRenderResult[] = [];
  const createdRequests: RequestRow[] = [];

  for (const { framing, pose } of poses) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    if (!pin) {
      results.push({ framing, pose, skipped: 'no_pin' });
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
    results.push({ framing, pose, created, request_id: row.id, status: row.status });
  }

  return { recipe_ref: recipeRef, results, createdRequests };
}
