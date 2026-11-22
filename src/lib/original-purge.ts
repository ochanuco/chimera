// 要らなくなった Generation の original と asset を R2 から消す定期ジョブ（src/index.ts scheduled）。
// D1 行と preview.webp は残すので「Generation は物理削除しない」は保たれる（docs/domain-model.md「original の保持」）。

import type { Bindings } from '../types';
import { ensureGenerationPreview, generationCutoutPreviewR2Key, generationPreviewR2Key } from './generation-preview';

export const ORIGINAL_RETENTION_DAYS = 14;

/** 1 tick の上限。Generation ごと最悪 7 subrequest（preview 作成 3、cutout preview の付け替え 2、R2 delete 1、D1 1）で 1000 に収める。 */
export const ORIGINAL_PURGE_BATCH_SIZE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

const IN_FLIGHT = `r.status IN ('queued', 'running')`;

/**
 * 消してよい Generation を古い順に返す。残すのは次のどれか:
 * - 価値の印がある（good / neutral、bookmark、公開 URL）
 * - その祖先（refines_generation_id を辿った全部。dof や saturation への deliver は worker が下の絵を読む）
 * - import（写真ページとワークベンチの背景が選ぶ写真）
 * - 木のどれかが最近作られた、木のワークベンチが最近触られた、木のどれかを進行中の Request が読む（作業中の木）
 * - pin・preset・Experiment・判定から参照されている
 */
const CANDIDATES_SQL = `
WITH RECURSIVE
tree(id, root_id) AS (
  SELECT id, id FROM generations WHERE refines_generation_id IS NULL
  UNION ALL
  SELECT c.id, t.root_id FROM generations c JOIN tree t ON c.refines_generation_id = t.id
),
busy(id) AS (
  SELECT g.id FROM requests r JOIN generations g ON json_extract(r.payload_json, '$.generation_id') IN (g.id, g.short_id) WHERE ${IN_FLIGHT}
  UNION SELECT g.id FROM requests r JOIN generations g ON json_extract(r.payload_json, '$.options.photo') IN (g.id, g.short_id) WHERE ${IN_FLIGHT}
  UNION SELECT g.id FROM requests r, json_each(r.payload_json, '$.references') ref
    JOIN generations g ON json_extract(ref.value, '$.generation_id') IN (g.id, g.short_id) WHERE ${IN_FLIGHT}
  UNION SELECT r.reroll_of_generation_id FROM requests r WHERE ${IN_FLIGHT} AND r.reroll_of_generation_id IS NOT NULL
),
valued(id) AS (
  SELECT g.id FROM generations g
  WHERE g.rating IN ('good', 'neutral') OR g.bookmark = 1
     OR EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id)
),
active_root(root_id) AS (
  SELECT t.root_id FROM tree t JOIN generations g ON g.id = t.id WHERE g.created_at >= ?1
  UNION SELECT t.root_id FROM tree t JOIN busy b ON b.id = t.id
  UNION SELECT w.root_generation_id FROM workbenches w WHERE w.updated_at >= ?1
),
valued_line(id) AS (
  SELECT id FROM valued
  UNION SELECT g.refines_generation_id FROM generations g JOIN valued_line l ON l.id = g.id WHERE g.refines_generation_id IS NOT NULL
)
SELECT g.id, g.r2_object_key FROM generations g
JOIN tree t ON t.id = g.id
LEFT JOIN requests src ON src.id = g.request_id
WHERE g.original_purged_at IS NULL
  AND (src.kind IS NULL OR src.kind <> 'import')
  AND g.id NOT IN (SELECT id FROM valued_line)
  AND t.root_id NOT IN (SELECT root_id FROM active_root)
  AND NOT EXISTS (SELECT 1 FROM preset_references pr WHERE pr.generation_id = g.id OR pr.source_generation_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM presets p WHERE p.source_generation_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.base_generation_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM experiment_runs er WHERE er.generation_id = g.id)
  AND NOT EXISTS (
    SELECT 1 FROM pairwise_judgments pj
    WHERE g.id IN (pj.left_generation_id, pj.right_generation_id, pj.baseline_generation_id)
  )
ORDER BY g.created_at ASC, g.id ASC
LIMIT ?2`;

interface Candidate {
  id: string;
  r2_object_key: string;
}

interface AssetRow {
  generation_id: string;
  role: string;
  region: string;
  r2_object_key: string;
}

export function purgeCutoff(nowMs: number): string {
  return new Date(nowMs - ORIGINAL_RETENTION_DAYS * DAY_MS).toISOString();
}

export async function findPurgeCandidates(db: D1Database, nowMs: number, limit = ORIGINAL_PURGE_BATCH_SIZE): Promise<Candidate[]> {
  const { results } = await db.prepare(CANDIDATES_SQL).bind(purgeCutoff(nowMs), limit).all<Candidate>();
  return results ?? [];
}

async function assetsOf(db: D1Database, ids: string[]): Promise<Map<string, AssetRow[]>> {
  const byGeneration = new Map<string, AssetRow[]>();
  if (ids.length === 0) return byGeneration;
  const { results } = await db
    .prepare(`SELECT generation_id, role, region, r2_object_key FROM generation_assets WHERE generation_id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<AssetRow>();
  for (const row of results ?? []) {
    const list = byGeneration.get(row.generation_id) ?? [];
    list.push(row);
    byGeneration.set(row.generation_id, list);
  }
  return byGeneration;
}

export interface PurgeResult {
  purged: number;
  skipped: number;
}

/**
 * 1 tick 分を消す。消す前に preview を用意する: cutout を持つ Generation は asset 行ごと消えるので、
 * cutout 由来の preview を preview.webp に移し、以後の /preview・MCP が cutout を探さずに済むようにする。
 * R2 を先に消してから行を確定する（途中で落ちても次の tick が同じ行を拾い直す）。
 */
export async function purgeUnneededOriginals(env: Bindings, nowMs: number, limit?: number): Promise<PurgeResult> {
  const db = env.DB;
  const now = new Date(nowMs).toISOString();
  const candidates = await findPurgeCandidates(db, nowMs, limit);
  const assets = await assetsOf(
    db,
    candidates.map((c) => c.id),
  );
  const result: PurgeResult = { purged: 0, skipped: 0 };

  for (const generation of candidates) {
    const own = assets.get(generation.id) ?? [];
    const hasCutout = own.some((a) => a.role === 'cutout' && a.region === '');
    const keys = [generation.r2_object_key, ...own.map((a) => a.r2_object_key)];

    if (await ensureGenerationPreview(env, generation)) {
      if (hasCutout) {
        const cutoutPreviewKey = generationCutoutPreviewR2Key(generation.id);
        const cutoutPreview = await env.IMAGES.get(cutoutPreviewKey);
        if (cutoutPreview) {
          await env.IMAGES.put(generationPreviewR2Key(generation.id), cutoutPreview.body, {
            httpMetadata: { contentType: 'image/webp' },
          });
          keys.push(cutoutPreviewKey);
        }
      }
    } else if (await env.IMAGES.head(generation.r2_object_key)) {
      console.warn(`original-purge: skipping ${generation.id}, no preview could be stored`);
      result.skipped += 1;
      continue;
    }

    await env.IMAGES.delete(keys);
    await db.batch([
      db.prepare('DELETE FROM generation_assets WHERE generation_id = ?').bind(generation.id),
      db.prepare('UPDATE generations SET original_purged_at = ? WHERE id = ?').bind(now, generation.id),
    ]);
    result.purged += 1;
  }

  if (result.purged + result.skipped > 0) {
    console.log(`original-purge: purged ${result.purged}, skipped ${result.skipped}`);
  }
  return result;
}
