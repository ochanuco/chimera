// 参考画像（kind reference の入力）の R2 一時領域 `references/{request_id}`。Generation の original と違い、使い終わったら消す。

import type { RequestKind, RequestStatus } from '../types';

export const REFERENCE_IMAGE_PREFIX = 'references/';

export const REFERENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

export const REFERENCE_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

export function referenceImageKey(requestId: string): string {
  return REFERENCE_IMAGE_PREFIX + requestId;
}

/** 先頭のバイト列で png / jpeg / webp を判定する。File.type はクライアントの申告なので信用しない。 */
export function sniffReferenceImageType(bytes: Uint8Array): (typeof REFERENCE_IMAGE_TYPES)[number] | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** done / failed / cancelled になった reference の参考画像を消す。queued に戻った行（retry）は残す。 */
export async function deleteSettledReferenceImages(
  bucket: R2Bucket,
  rows: readonly { id: string; kind: RequestKind; status: RequestStatus }[],
): Promise<void> {
  const keys = rows
    .filter((r) => r.kind === 'reference' && (r.status === 'done' || r.status === 'failed' || r.status === 'cancelled'))
    .map((r) => referenceImageKey(r.id));
  if (keys.length > 0) await bucket.delete(keys);
}

/** Cron: 置かれてから REFERENCE_IMAGE_TTL_MS を過ぎた参考画像を消す。終端での削除を取りこぼしたものの掃除。 */
export async function sweepReferenceImages(bucket: R2Bucket, nowMs: number): Promise<number> {
  const threshold = nowMs - REFERENCE_IMAGE_TTL_MS;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: REFERENCE_IMAGE_PREFIX, cursor });
    const stale = page.objects.filter((o) => o.uploaded.getTime() <= threshold).map((o) => o.key);
    if (stale.length > 0) {
      await bucket.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
