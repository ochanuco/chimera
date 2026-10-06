export type SafetyVerdictView = 'block' | 'sensitive' | 'caution' | 'none';

export interface SafetyView {
  verdict: SafetyVerdictView;
  reasons: string[];
}

export interface SafetyDetailData extends SafetyView {
  model: string;
  rating: { general: number; sensitive: number; questionable: number; explicit: number };
  rated_at: string;
}

export const SAFETY_LABELS: Record<Exclude<SafetyVerdictView, 'none'>, string> = {
  block: '出さない',
  sensitive: 'センシティブ',
  caution: '注意',
};

/** サムネイル下のピルと詳細ページ共通。none / 未採点は何も出さない。色は static.ts の .safety-badge-*。 */
export function SafetyBadge({ safety }: { safety: SafetyView | null | undefined }) {
  if (!safety || safety.verdict === 'none') return null;
  return (
    <span class={`safety-badge safety-badge-${safety.verdict}`} title={safety.reasons.join(', ')}>
      {SAFETY_LABELS[safety.verdict]}
    </span>
  );
}

/** 詳細ページの `安全性` 行。4 つの数値と判定理由を出す。未採点は「未採点」。 */
export function SafetySection({ safety }: { safety: SafetyDetailData | null | undefined }) {
  if (!safety) {
    return (
      <p class="safety-row">
        <span class="safety-row-label">安全性</span> <span class="safety-unrated">未採点</span>
      </p>
    );
  }
  const { rating } = safety;
  return (
    <div class="safety-row">
      <span class="safety-row-label">安全性</span> <SafetyBadge safety={safety} />
      <span class="safety-numbers">
        general {rating.general.toFixed(3)} · sensitive {rating.sensitive.toFixed(3)} · questionable{' '}
        {rating.questionable.toFixed(3)} · explicit {rating.explicit.toFixed(3)}
      </span>
      {safety.reasons.length > 0 ? <span class="safety-reasons">{safety.reasons.join(', ')}</span> : null}
    </div>
  );
}
