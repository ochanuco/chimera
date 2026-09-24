// 絵柄チェック (docs/ui.md「絵柄チェック」): 代表ポーズを今のカタログ既定で並べ、pin から
// 絵柄がずれていないか人間が見比べる。生成そのものは plain_render (lib/plain-render.ts) と
// 同じ経路 — このファイルは「どのポーズを並べるか」の正本と、既存の plain render request を
// 探す/積むだけの薄い層。

import { buildPlainRenderRequest, plainRenderIdempotencyKey } from './plain-render';
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
 * recipe ごとの代表ポーズ一覧 — 絵柄チェックの唯一の正本。増減・入れ替えはここだけ直す。
 * 各 pose は Preset (`getPresetRow`) として存在し、pin (`preset_references`) を持っている
 * ことを前提にする (無ければ行は「pin 無し」表示になり、描けない)。
 */
export const STYLE_CHECK_POSES: Record<string, StyleCheckPose[]> = {
  [STYLE_CHECK_RECIPE]: [
    { framing: 'bust', pose: 'bust' },
    { framing: 'cowboy', pose: 'coffee' },
    { framing: 'cowboy', pose: 'gao' },
    { framing: 'full', pose: 'step' },
    { framing: 'full', pose: 'dance' },
  ],
};

export interface StyleCheckRow {
  framing: string;
  pose: string;
  /** 現在の pin。無ければこの pose の行は描けない (GET /check「pin 無し」)。 */
  pin: PresetReferenceView | null;
  /** pin があるときだけ埋まる、今のカタログ commit での plain render の default idempotency key。 */
  idempotency_key: string | null;
  /** その key に一致する既存 request。無ければ「まだ描いていない」。 */
  request: RequestRow | null;
}

/**
 * GET /check が描く行データ: pose ごとに現在の pin と、今の catalog commit での plain render
 * request (あれば) を集める。何も積まない — 既存の request を探すだけ (createRequest は呼ばない)。
 */
export async function loadStyleCheckRows(
  db: D1Database,
  recipe: string,
  gitCommit: string | null,
): Promise<StyleCheckRow[]> {
  const poses = STYLE_CHECK_POSES[recipe] ?? [];
  const rows: StyleCheckRow[] = [];
  for (const { framing, pose } of poses) {
    const pin = await referenceView(db, await getCurrentReference(db, recipe, 'pose', pose));
    let idempotencyKey: string | null = null;
    let request: RequestRow | null = null;
    if (pin) {
      idempotencyKey = plainRenderIdempotencyKey(recipe, pose, pin.seed, gitCommit);
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
 * POST /api/v1/style-check/{recipe}: pin を持つ代表ポーズごとに、MCP `plain_render`
 * (src/mcp.ts) と同じ組み立て (buildPlainRenderRequest → createRequest) で
 * kind=generate を積む。default idempotency key なので、同じ catalog commit への連打は
 * 何も作らず既存行を返す (created: false)。pin が無い pose は skip され、結果に理由が残る。
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

    const built = await buildPlainRenderRequest(db, { recipe, pose, recipe_ref: recipeRef });
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
