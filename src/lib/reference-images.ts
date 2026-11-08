// 参考画像（kind reference の入力）の R2 一時領域 `references/{request_id}`。Generation の original と違い、使い終わったら消す。

import { nowIso } from './db';
import { computeSafetyVerdict, type SafetyRating, type SafetyVerdict, type SafetyVerdictResult } from './safety';
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

/**
 * 判定がこのどれかの参考画像だけ、解析の後も 24 時間の掃除まで残し、agent（MCP get_reference_image）が読める。
 * sensitive / block と未判定は残さない（持ち主の決定、2026-11-08）。
 */
export const READABLE_REFERENCE_VERDICTS: readonly SafetyVerdict[] = ['none', 'caution'];

export interface ReferenceSafetyRow {
  request_id: string;
  model: string;
  rating_json: string;
  tags_json: string;
  rated_at: string;
}

export function referenceVerdict(row: ReferenceSafetyRow): SafetyVerdictResult {
  return computeSafetyVerdict(JSON.parse(row.rating_json) as SafetyRating, JSON.parse(row.tags_json) as Record<string, number>);
}

export async function getReferenceSafety(db: D1Database, requestId: string): Promise<ReferenceSafetyRow | null> {
  return db.prepare('SELECT * FROM reference_safety WHERE request_id = ?').bind(requestId).first<ReferenceSafetyRow>();
}

/** 判定が残してよいものか。未判定は false。 */
export function isReadableReference(row: ReferenceSafetyRow | null): boolean {
  return row !== null && READABLE_REFERENCE_VERDICTS.includes(referenceVerdict(row).verdict);
}

/** worker が送った参考画像の判定を保存し、残してよくなければその場で画像を消す。 */
export async function putReferenceSafety(
  db: D1Database,
  bucket: R2Bucket,
  requestId: string,
  input: { model: string; rating: SafetyRating; tags: Record<string, number> },
): Promise<{ row: ReferenceSafetyRow; kept: boolean }> {
  const row: ReferenceSafetyRow = {
    request_id: requestId,
    model: input.model,
    rating_json: JSON.stringify(input.rating),
    tags_json: JSON.stringify(input.tags),
    rated_at: nowIso(),
  };
  await db
    .prepare(
      `INSERT INTO reference_safety (request_id, model, rating_json, tags_json, rated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET model = excluded.model, rating_json = excluded.rating_json,
         tags_json = excluded.tags_json, rated_at = excluded.rated_at`,
    )
    .bind(row.request_id, row.model, row.rating_json, row.tags_json, row.rated_at)
    .run();
  const kept = isReadableReference(row) && (await bucket.head(referenceImageKey(requestId))) !== null;
  if (!isReadableReference(row)) await bucket.delete(referenceImageKey(requestId));
  return { row, kept };
}

/**
 * done / failed / cancelled になった reference の参考画像を消す。queued に戻った行（retry）は残す。
 * done で判定が読めるもの（READABLE_REFERENCE_VERDICTS）は 24 時間の掃除まで残す。
 */
export async function deleteSettledReferenceImages(
  db: D1Database,
  bucket: R2Bucket,
  rows: readonly { id: string; kind: RequestKind; status: RequestStatus }[],
): Promise<void> {
  const settled = rows.filter(
    (r) => r.kind === 'reference' && (r.status === 'done' || r.status === 'failed' || r.status === 'cancelled'),
  );
  const keys: string[] = [];
  for (const r of settled) {
    if (r.status === 'done' && isReadableReference(await getReferenceSafety(db, r.id))) continue;
    keys.push(referenceImageKey(r.id));
  }
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
