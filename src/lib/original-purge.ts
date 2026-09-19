// 保持期間を過ぎた低価値 Generation の original.png を削除する定期ジョブ (src/index.ts scheduled)。
// D1 行と preview.webp は残す — 消えるのは original オブジェクトだけで、
// 「Generation は物理削除しない」(CLAUDE.md) 不変条件はそのまま保たれる。

import type { Bindings, GenerationRow } from '../types';
import { ensureGenerationPreview } from './generation-preview';

export const ORIGINAL_RETENTION_DAYS = 30;

/** env var 未設定時の1回あたり処理件数。 */
const DEFAULT_BATCH_SIZE = 100;

function resolveBatchSize(env: Bindings): number {
  const raw = env.ORIGINAL_PURGE_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

/**
 * 保持期間を過ぎ、かつどこからも参照されていない unrated/bad の Generation を古い順に返す。
 * 各 NOT EXISTS は original がまだ用済みでない理由に1つずつ対応する
 * (docs/domain-model.md「original の保持」): Publication・pose 基準 render の pin・
 * profile の起点・Experiment の起点・他 Batch の参照材料・仕上げ元・進行中の
 * finalize/repair/masked_redraw request。最後の request 判定は
 * src/lib/requests.ts の generation_id フィルタ (id / short_id どちらでも一致) と
 * 同じ idiom。
 */
async function findPurgeCandidates(db: D1Database, cutoff: string, limit: number): Promise<GenerationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.* FROM generations g
       WHERE g.original_purged_at IS NULL
         AND (g.rating IS NULL OR g.rating = 'bad')
         AND g.bookmark = 0
         AND g.created_at < ?
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
         )
       ORDER BY g.created_at ASC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<GenerationRow>();
  return results ?? [];
}

export interface PurgeOldOriginalsResult {
  purged: number;
  skipped: number;
}

/**
 * 1回分の purge を実行する。Generation ごとに最悪 ~5 subrequest
 * (preview 確認の R2 get、無ければ transform 用の get + put、original の delete、
 * 無ければ head) かかるので、既定のバッチサイズは Workers Paid の 1000 subrequest 予算に
 * 余裕を持って収まる値にしてある。env.ORIGINAL_PURGE_BATCH_SIZE で上書きできる。
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
