// Content-rating (X 投稿可否) の判定。worker が WD tagger の生スコアを PUT し、閾値はここだけが持つ。

import { nowIso } from './db';
import type { GenerationSafetyRow } from '../types';

export const EXPOSURE_TAGS = [
  'nipples',
  'areolae',
  'pussy',
  'penis',
  'anus',
  'completely_nude',
  'nude',
  'topless',
  'bottomless',
  'breasts_out',
] as const;

export const CERTAIN_TAGS = ['cameltoe', 'crotch', 'groin', 'crotch_seam', 'covered_nipples'] as const;
export const SUSPECT_TAGS = ['ass', 'ass_focus', 'panties', 'pantyshot', 'upskirt', 'spread_legs', 'bent_over', 'cleavage'] as const;
export const X_SAFE_TAGS = [
  'pantyhose',
  'thighband_pantyhose',
  'thighs',
  'legs',
  'feet',
  'soles',
  'toes',
  'no_shoes',
  'sitting',
  'knees_up',
  'wariza',
  'yokozuwari',
  'lying',
  'navel',
  'midriff',
] as const;

export type TagXRisk = 'exposure' | 'certain' | 'suspect' | 'safe';

/**
 * タグごとの X での効き方。区分は持ち主の経験に従う: タイツ・足は X に flag されず、尻は怪しく、乳・股間は確実。
 * 閾値は 2026-10-07 に保存済みの判定から決めた（suspect 0.5 以上は 9,491 枚中およそ 780 枚、X に flag された tuv2ha は ass 0.95）。
 */
export const TAG_X_RISK: Readonly<Record<string, TagXRisk>> = {
  ...Object.fromEntries(X_SAFE_TAGS.map((t) => [t, 'safe' as const])),
  ...Object.fromEntries(SUSPECT_TAGS.map((t) => [t, 'suspect' as const])),
  ...Object.fromEntries(CERTAIN_TAGS.map((t) => [t, 'certain' as const])),
  ...Object.fromEntries(EXPOSURE_TAGS.map((t) => [t, 'exposure' as const])),
};

export const RISKY_TAGS: readonly string[] = Object.keys(TAG_X_RISK);

export const BLOCK_TAG_THRESHOLD = 0.15;
export const SENSITIVE_QUESTIONABLE_THRESHOLD = 0.15;
export const CERTAIN_TAG_THRESHOLD = 0.35;
export const SUSPECT_TAG_THRESHOLD = 0.5;

export type SafetyVerdict = 'block' | 'sensitive' | 'caution' | 'none';

export interface SafetyRating {
  general: number;
  sensitive: number;
  questionable: number;
  explicit: number;
}

export interface SafetyVerdictResult {
  verdict: SafetyVerdict;
  reasons: string[];
}

const fmt = (n: number) => n.toFixed(2);

const byValueDesc = (a: string, b: string) => Number(b.split(' ')[1]) - Number(a.split(' ')[1]);

const hits = (names: readonly string[], tags: Record<string, number>, threshold: number) =>
  names
    .filter((t) => (tags[t] ?? 0) >= threshold)
    .sort((a, b) => tags[b]! - tags[a]!)
    .map((t) => `${t} ${fmt(tags[t]!)}`);

/** 先に当たった順 block > sensitive > caution > none。 */
export function computeSafetyVerdict(rating: SafetyRating, tags: Record<string, number>): SafetyVerdictResult {
  const exposure = hits(EXPOSURE_TAGS, tags, BLOCK_TAG_THRESHOLD);
  if (exposure.length > 0) return { verdict: 'block', reasons: exposure };
  const certain = hits(CERTAIN_TAGS, tags, CERTAIN_TAG_THRESHOLD);
  if (rating.questionable >= SENSITIVE_QUESTIONABLE_THRESHOLD || certain.length > 0) {
    const questionable = rating.questionable >= SENSITIVE_QUESTIONABLE_THRESHOLD ? [`questionable ${fmt(rating.questionable)}`] : [];
    return { verdict: 'sensitive', reasons: [...questionable, ...certain].sort(byValueDesc) };
  }
  const suspect = hits(SUSPECT_TAGS, tags, SUSPECT_TAG_THRESHOLD);
  if (suspect.length > 0) return { verdict: 'caution', reasons: suspect };
  return { verdict: 'none', reasons: [] };
}

export function serializeSafety(row: GenerationSafetyRow, opts: { includeTags: boolean }) {
  const rating = JSON.parse(row.rating_json) as SafetyRating;
  const tags = JSON.parse(row.tags_json) as Record<string, number>;
  const { verdict, reasons } = computeSafetyVerdict(rating, tags);
  return {
    model: row.model,
    rating,
    verdict,
    reasons,
    rated_at: row.rated_at,
    ...(opts.includeTags ? { tags } : {}),
  };
}

export type SafetySummary = ReturnType<typeof serializeSafety>;

export async function getSafetyForGeneration(db: D1Database, generationId: string): Promise<GenerationSafetyRow | null> {
  return db.prepare('SELECT * FROM generation_safety WHERE generation_id = ?').bind(generationId).first<GenerationSafetyRow>();
}

export async function putSafety(
  db: D1Database,
  generationId: string,
  input: { model: string; rating: SafetyRating; tags: Record<string, number> },
): Promise<GenerationSafetyRow> {
  const row: GenerationSafetyRow = {
    generation_id: generationId,
    model: input.model,
    rating_json: JSON.stringify(input.rating),
    tags_json: JSON.stringify(input.tags),
    rated_at: nowIso(),
  };
  await db
    .prepare(
      `INSERT INTO generation_safety (generation_id, model, rating_json, tags_json, rated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(generation_id) DO UPDATE SET model = excluded.model, rating_json = excluded.rating_json,
         tags_json = excluded.tags_json, rated_at = excluded.rated_at`,
    )
    .bind(row.generation_id, row.model, row.rating_json, row.tags_json, row.rated_at)
    .run();
  return row;
}

export type PublishWarning = { verdict: 'block' | 'sensitive'; reasons: string[]; message: string };

const WARNING_MESSAGES = {
  block: '露出表現の疑いが高いため、X に出さない方がよい画像です',
  sensitive: 'X のセンシティブ設定（センシティブな内容を含む）を付けて投稿してください',
} as const;

/** 公開記録時の警告。block / sensitive 以外は null。 */
export async function publishWarningFor(db: D1Database, generationId: string): Promise<PublishWarning | null> {
  const row = await getSafetyForGeneration(db, generationId);
  if (!row) return null;
  const { verdict, reasons } = serializeSafety(row, { includeTags: false });
  if (verdict !== 'block' && verdict !== 'sensitive') return null;
  return { verdict, reasons, message: WARNING_MESSAGES[verdict] };
}
