// 保持期間を過ぎた低価値 Generation の original.png を削除する定期ジョブ (src/index.ts scheduled)。
// D1 行と preview.webp は残すため「Generation は物理削除しない」不変条件は保たれる。

import type { Bindings, GenerationRow } from '../types';
import { ensureGenerationPreview } from './generation-preview';
import { rescueGraphFromOriginal } from './graph-rescue';

export const ORIGINAL_RETENTION_DAYS = 30;

/** env var 未設定時の1回あたり処理件数。original-recompress.ts もこの解決を共有する。 */
const DEFAULT_BATCH_SIZE = 100;

export function resolveBatchSize(env: Bindings): number {
  const raw = env.ORIGINAL_PURGE_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

/**
 * `generations g` が purge 対象になる条件 (保持期間と purge 済みかどうかを除く)。
 * original-recompress.ts はこの否定を使い、purge の順番待ちをしている original を再圧縮しない。
 */
export const PURGE_ELIGIBLE_SQL = `(g.rating IS NULL OR g.rating = 'bad')
    AND g.bookmark = 0
    AND NOT EXISTS (SELECT 1 FROM generation_publications gp WHERE gp.generation_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM preset_references pr WHERE pr.generation_id = g.id OR pr.source_generation_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM presets p WHERE p.source_generation_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.base_generation_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM batch_references br WHERE br.source_generation_id = g.id)
    AND NOT EXISTS (SELECT 1 FROM batches b WHERE b.refines_generation_id = g.id)
    AND NOT EXISTS (
      SELECT 1 FROM requests r
      WHERE r.kind IN ('finalize', 'repair', 'masked_redraw')
        AND r.status NOT IN ('done', 'failed', 'cancelled')
        AND json_extract(r.payload_json, '$.generation_id') IN (g.id, g.short_id)
    )`;

/** A purge candidate row, plus whether its Job's graph is still unrescued (see findPurgeCandidates). */
interface PurgeCandidate extends GenerationRow {
  job_graph_is_null: 0 | 1;
}

/**
 * 保持期間を過ぎ、かつどこからも参照されていない unrated/bad の Generation を古い順に返す。
 * 各 NOT EXISTS は original がまだ用済みでない理由に1つずつ対応する (docs/domain-model.md「original の保持」)。
 * comfy_jobs を join して返す `job_graph_is_null` により、purgeOldOriginals は救出用の original 読み込みを必要な行だけに絞れる。
 */
async function findPurgeCandidates(db: D1Database, cutoff: string, limit: number): Promise<PurgeCandidate[]> {
  const { results } = await db
    .prepare(
      `SELECT g.*, (j.graph IS NULL) AS job_graph_is_null FROM generations g
       JOIN comfy_jobs j ON j.id = g.comfy_job_id
       WHERE g.original_purged_at IS NULL
         AND g.created_at < ?
         AND ${PURGE_ELIGIBLE_SQL}
       ORDER BY g.created_at ASC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<PurgeCandidate>();
  return results ?? [];
}

export interface PurgeOldOriginalsResult {
  purged: number;
  skipped: number;
}

/**
 * 1回分の purge を実行する。Generation ごと最悪 ~5 subrequest。scheduled ハンドラは同じ invocation で
 * 直後に original-recompress.ts の再圧縮 (Generation ごと最悪 ~6 subrequest) も走らせるため、
 * 既定値は purge ≤100×5=500 + recompress ≤60×6=360 で Workers Paid の 1000 subrequest 予算に収まるよう選んである。
 */
export async function purgeOldOriginals(env: Bindings, now: string, limit?: number): Promise<PurgeOldOriginalsResult> {
  const db = env.DB;
  const cutoff = new Date(new Date(now).getTime() - ORIGINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const batchSize = limit ?? resolveBatchSize(env);

  const candidates = await findPurgeCandidates(db, cutoff, batchSize);

  let purged = 0;
  let skipped = 0;

  for (const generation of candidates) {
    const hasPreview = await ensureGenerationPreview(env, generation);
    if (!hasPreview) {
      const head = await env.IMAGES.head(generation.r2_object_key);
      if (!head) {
        // original も preview も無い: 消すものが残っていないので行だけ確定する。
        await db.prepare('UPDATE generations SET original_purged_at = ? WHERE id = ?').bind(now, generation.id).run();
        purged += 1;
      } else {
        console.warn(`original-purge: skipping ${generation.short_id}, original present but no preview could be created`);
        skipped += 1;
      }
      continue;
    }

    // グラフの救出は original を消す前の最後の機会: job_graph_is_null は join 済みなので、
    // 普段 (graph が既にある) は original を余分に読まずに済む。
    if (generation.job_graph_is_null) {
      const original = await env.IMAGES.get(generation.r2_object_key);
      if (original) {
        await rescueGraphFromOriginal(env, generation, new Uint8Array(await original.arrayBuffer()));
      }
    }

    // R2 の delete を先にする: 途中で落ちても次回は「original は既に無く preview は
    // ある」状態から再開でき、行を確定するだけで済む (二重 delete を試みない)。
    await env.IMAGES.delete(generation.r2_object_key);
    await db.prepare('UPDATE generations SET original_purged_at = ? WHERE id = ?').bind(now, generation.id).run();
    purged += 1;
  }

  if (purged + skipped > 0) {
    console.log(`original-purge: purged ${purged}, skipped ${skipped}`);
  }

  return { purged, skipped };
}
