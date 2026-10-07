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

export type RiskyTagAxis = 'exposure' | 'questionable' | 'sensitive' | 'neutral';

/**
 * 詳細ページで「効いていそうなタグ」として拾うタグと、どの区分に効きやすいか。tagger は判定理由を返さないので推定。
 * 区分は 2026-10-07 の判定済み 9,491 枚で、タグ確率 0.35 以上の絵が基準をどれだけ超えるかで決めた:
 * かなり際どい 15% 以上の割合が基準 2.4% の 3 倍以上なら questionable、少し際どい 95% 以上の割合が基準 25.2% を
 * 超えれば sensitive、どちらも超えなければ neutral。panties / pantyshot と同時に出る絵は他のタグの数字を押し上げるので、
 * panties・pantyshot 以外のタグはそれらが出ていない 9,208 枚で数え直した（wariza はこれで neutral）。
 */
export const RISKY_TAG_AXIS: Readonly<Record<string, RiskyTagAxis>> = {
  ...Object.fromEntries(EXPOSURE_TAGS.map((t) => [t, 'exposure' as const])),
  ass: 'questionable',
  navel: 'questionable',
  lying: 'questionable',
  panties: 'questionable',
  thighs: 'questionable',
  legs: 'sensitive',
  soles: 'sensitive',
  feet: 'sensitive',
  thighband_pantyhose: 'sensitive',
  no_shoes: 'sensitive',
  sitting: 'sensitive',
  knees_up: 'sensitive',
  pantyhose: 'sensitive',
  pantyshot: 'sensitive',
  spread_legs: 'sensitive',
  cleavage: 'sensitive',
  midriff: 'sensitive',
  wariza: 'neutral',
  yokozuwari: 'neutral',
};

export const RISKY_TAGS: readonly string[] = Object.keys(RISKY_TAG_AXIS);

export const BLOCK_TAG_THRESHOLD = 0.15;
export const SENSITIVE_QUESTIONABLE_THRESHOLD = 0.15;
export const CAUTION_SENSITIVE_THRESHOLD = 0.95;

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

/** 先に当たった順 block > sensitive > caution > none。 */
export function computeSafetyVerdict(rating: SafetyRating, tags: Record<string, number>): SafetyVerdictResult {
  const exposure = EXPOSURE_TAGS.filter((t) => (tags[t] ?? 0) >= BLOCK_TAG_THRESHOLD).map((t) => `${t} ${fmt(tags[t]!)}`);
  if (exposure.length > 0) return { verdict: 'block', reasons: exposure };
  if (rating.questionable >= SENSITIVE_QUESTIONABLE_THRESHOLD) {
    return { verdict: 'sensitive', reasons: [`questionable ${fmt(rating.questionable)}`] };
  }
  if (rating.sensitive >= CAUTION_SENSITIVE_THRESHOLD) {
    return { verdict: 'caution', reasons: [`sensitive ${fmt(rating.sensitive)}`] };
  }
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
