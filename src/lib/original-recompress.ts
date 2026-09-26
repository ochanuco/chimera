// 保持期間を過ぎても original を持ち続けている Generation を、purge の後で lossless WebP
// (~32% 小さく、不透明なら画素同一) へ再圧縮する定期ジョブ (src/index.ts scheduled)。
// 透過 PNG は変換しない — alpha=0 の下の RGB は lossless 再エンコードでも保存されず、ComfyUI の
// LoadImage はそこを読むため。PNG の `prompt` text chunk は graph-rescue.ts が先に救出する。

import type { Bindings, GenerationRow } from '../types';
import { MAX_TRANSFORM_INPUT_BYTES } from './generation-preview';
import { rescueGraphFromOriginal } from './graph-rescue';
import { extractPngTextChunk, parsePngDimensions, pngHasTransparency } from './image-meta';
import { ORIGINAL_RETENTION_DAYS, PURGE_ELIGIBLE_SQL, resolveBatchSize } from './original-purge';

// original-purge.ts と合わせて Workers Paid の 1000 subrequest 予算に収まるようにしたキャップ。
const RECOMPRESS_BATCH_CAP = 60;

export interface RecompressRetainedOriginalsResult {
  converted: number;
  kept: number;
}

async function findRecompressCandidates(db: D1Database, cutoff: string, limit: number): Promise<GenerationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.* FROM generations g
       WHERE g.original_purged_at IS NULL
         AND g.original_recompress_checked_at IS NULL
         AND g.created_at < ?
         AND NOT (${PURGE_ELIGIBLE_SQL})
       ORDER BY g.created_at ASC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<GenerationRow>();
  return results ?? [];
}

/** 1回分の再圧縮を実行する。env.ORIGINAL_RECOMPRESS が 'on' でなければクエリすら投げず {converted: 0, kept: 0} を返す。 */
export async function recompressRetainedOriginals(
  env: Bindings,
  now: string,
  limit?: number,
): Promise<RecompressRetainedOriginalsResult> {
  if (env.ORIGINAL_RECOMPRESS !== 'on') return { converted: 0, kept: 0 };

  const db = env.DB;
  const cutoff = new Date(new Date(now).getTime() - ORIGINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const batchSize = limit ?? Math.min(resolveBatchSize(env), RECOMPRESS_BATCH_CAP);

  const candidates = await findRecompressCandidates(db, cutoff, batchSize);

  let converted = 0;
  let kept = 0;

  const markChecked = (id: string) =>
    db.prepare('UPDATE generations SET original_recompress_checked_at = ? WHERE id = ?').bind(now, id).run();

  for (const generation of candidates) {
    const object = await env.IMAGES.get(generation.r2_object_key);
    if (!object) {
      await markChecked(generation.id);
      kept += 1;
      continue;
    }
    if (object.size > MAX_TRANSFORM_INPUT_BYTES) {
      await markChecked(generation.id);
      kept += 1;
      continue;
    }

    const bytes = new Uint8Array(await object.arrayBuffer());
    const dimensions = parsePngDimensions(bytes);
    if (!dimensions || pngHasTransparency(bytes)) {
      await markChecked(generation.id);
      kept += 1;
      continue;
    }

    const graphPresent = await rescueGraphFromOriginal(env, generation, bytes);
    if (!graphPresent && extractPngTextChunk(bytes, 'prompt') !== null) {
      // prompt チャンクはあるのに救出できなかった: これから壊すデータに graph が残っているので変換を諦める。
      await markChecked(generation.id);
      kept += 1;
      continue;
    }

    let webpBytes: Uint8Array;
    try {
      const result = await env.IMAGE_TRANSFORM.input(new Response(bytes).body!).output({ format: 'image/webp', quality: 100 });
      webpBytes = new Uint8Array(await result.response().arrayBuffer());
    } catch (err) {
      // マークしない: 一時的な失敗かもしれないので次回また候補に上げる。
      console.warn(`original-recompress: transform failed for ${generation.short_id}`, err);
      kept += 1;
      continue;
    }

    const info = await env.IMAGE_TRANSFORM.info(new Response(webpBytes).body!);
    const validFormat = info.format === 'image/webp';
    const validSize = 'width' in info && info.width === dimensions.width && info.height === dimensions.height;
    if (!validFormat || !validSize || webpBytes.byteLength >= bytes.byteLength) {
      await markChecked(generation.id);
      kept += 1;
      continue;
    }

    const webpKey = `generations/${generation.id}/original.webp`;
    // PUT → D1 更新 → 旧 PNG delete の順: どの段階で落ちても r2_object_key は実在するオブジェクトを指す。
    await env.IMAGES.put(webpKey, webpBytes, { httpMetadata: { contentType: 'image/webp' } });
    await db
      .prepare('UPDATE generations SET r2_object_key = ?, image_size = ?, original_recompress_checked_at = ? WHERE id = ?')
      .bind(webpKey, webpBytes.byteLength, now, generation.id)
      .run();
    await env.IMAGES.delete(generation.r2_object_key);
    converted += 1;
  }

  if (converted + kept > 0) {
    console.log(`original-recompress: converted ${converted}, kept ${kept}`);
  }

  return { converted, kept };
}
