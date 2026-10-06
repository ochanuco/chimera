import {
  BLOCK_TAG_THRESHOLD,
  CAUTION_SENSITIVE_THRESHOLD,
  SENSITIVE_QUESTIONABLE_THRESHOLD,
} from '../../lib/safety';

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

const RATING_LABELS: [keyof SafetyDetailData['rating'], string][] = [
  ['general', '全年齢'],
  ['sensitive', '少し際どい'],
  ['questionable', 'かなり際どい'],
  ['explicit', '成人向け'],
];

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** reasons は API 互換のため `name 0.47` 形式のまま。表示だけ日本語と % に直す。 */
function reasonText(safety: SafetyDetailData): string | null {
  const { verdict, rating, reasons } = safety;
  if (verdict === 'block') {
    const tags = reasons.map((r) => {
      const [name, value] = r.split(' ');
      return `${name} ${pct(Number(value))}`;
    });
    return `露出タグ ${tags.join(', ')}（${pct(BLOCK_TAG_THRESHOLD)} 以上で出さない）`;
  }
  if (verdict === 'sensitive') {
    return `かなり際どい ${pct(rating.questionable)}（${pct(SENSITIVE_QUESTIONABLE_THRESHOLD)} 以上でセンシティブ）`;
  }
  if (verdict === 'caution') {
    return `少し際どい ${pct(rating.sensitive)}（${pct(CAUTION_SENSITIVE_THRESHOLD)} 以上で注意）`;
  }
  return null;
}

/** 詳細ページの `安全性` 行。総合判定だけ見せ、理由と 4 区分の % は折りたたむ。未採点は「未採点」。 */
export function SafetySection({ safety }: { safety: SafetyDetailData | null | undefined }) {
  if (!safety) {
    return (
      <p class="safety-row">
        <span class="safety-row-label">安全性</span> <span class="safety-unrated">未採点</span>
      </p>
    );
  }
  const reason = reasonText(safety);
  return (
    <details class="safety-row">
      <summary>
        <span class="safety-row-label">安全性</span>{' '}
        {safety.verdict === 'none' ? <span class="safety-ok">問題なし</span> : <SafetyBadge safety={safety} />}
      </summary>
      {reason ? <p class="safety-reasons">{reason}</p> : null}
      <p class="safety-numbers">
        {RATING_LABELS.map(([key, label]) => `${label} ${pct(safety.rating[key])}`).join(' · ')}
      </p>
    </details>
  );
}
