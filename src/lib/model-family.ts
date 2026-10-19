export type ModelFamily = 'moss' | 'anima' | 'il';

/** Gallery の「モデル系統」絞り込み値。`unknown` は model_family が NULL の行。 */
export const MODEL_FILTER_VALUES = ['anima', 'il', 'moss', 'unknown'] as const;
export type ModelFilterValue = (typeof MODEL_FILTER_VALUES)[number];

export const MODEL_FILTER_LABELS: Record<ModelFilterValue, string> = { anima: 'Anima', il: 'IL', moss: 'MOSS', unknown: '不明' };

/**
 * checkpoint 名から系統を決める。migrations/0050 の backfill SQL と同じ規則なので、変えるときは両方を揃える。
 * 「animagine」は IL/SDXL 系の名前なので anima と取り違えない。
 */
export function modelFamilyOf(checkpoints: readonly string[]): ModelFamily | null {
  const names = checkpoints.map((n) => n.toLowerCase());
  if (names.some((n) => n.includes('moss'))) return 'moss';
  if (names.some((n) => n.includes('anima') && !n.includes('animagine'))) return 'anima';
  return names.length > 0 ? 'il' : null;
}
