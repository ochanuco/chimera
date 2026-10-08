import {
  BLOCK_TAG_THRESHOLD,
  CERTAIN_TAG_THRESHOLD,
  RISKY_TAGS,
  SENSITIVE_QUESTIONABLE_THRESHOLD,
  SUSPECT_TAG_THRESHOLD,
  TAG_X_RISK,
  type TagXRisk,
} from '../../lib/safety';

export type SafetyVerdictView = 'block' | 'sensitive' | 'caution' | 'none';

export type SafetyRatingView = { general: number; sensitive: number; questionable: number; explicit: number };

export interface SafetyView {
  verdict: SafetyVerdictView;
  reasons: string[];
  rating: SafetyRatingView;
}

export interface SafetyDetailData extends SafetyView {
  model: string;
  rated_at: string;
  tags?: Record<string, number>;
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

const RATING_LABELS: [keyof SafetyRatingView, string][] = [
  ['general', '全年齢'],
  ['sensitive', '少し際どい'],
  ['questionable', 'かなり際どい'],
  ['explicit', '成人向け'],
];

/** 色は static.ts の --r-*。 */
const RATING_COLOR_VARS: Record<keyof SafetyRatingView, string> = {
  general: '--r-general',
  sensitive: '--r-sensitive',
  questionable: '--r-questionable',
  explicit: '--r-explicit',
};

/** 一桁小数の %。0.1% 未満は 0%。 */
export const fmtPct = (value: number) => `${value < 0.001 ? '0' : (Math.round(value * 1000) / 10).toFixed(1)}%`;

const ratingText = (rating: SafetyRatingView) =>
  RATING_LABELS.map(([key, label]) => `${label} ${fmtPct(rating[key])}`).join('、');

/** 4 区分の積み上げ帯。サムネイル下の細帯 (`strip`)、詳細の太帯 (`stack`)、比較の小帯 (`mini`) が共有する。 */
export function RatingBar({ rating, variant }: { rating: SafetyRatingView; variant: 'strip' | 'stack' | 'mini' }) {
  return (
    <div class={`rating-bar rating-bar-${variant}`} role="img" aria-label={ratingText(rating)}>
      {RATING_LABELS.map(([key]) => (
        <span style={`width:${rating[key] * 100}%;background:var(${RATING_COLOR_VARS[key]})`} />
      ))}
    </div>
  );
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** reasons は API 互換のため `name 0.47` 形式のまま。表示だけ % に直す。 */
function reasonItems(reasons: string[]): string[] {
  return reasons.map((r) => {
    const [name, value] = r.split(' ');
    return `${name === 'questionable' ? 'かなり際どい' : name} ${pct(Number(value))}`;
  });
}

function reasonText(verdict: SafetyVerdictView, reasons: string[]): string | null {
  const items = reasonItems(reasons);
  if (verdict === 'block') return `露出タグ ${items.join(', ')}（${pct(BLOCK_TAG_THRESHOLD)} 以上で出さない）`;
  if (verdict === 'sensitive') {
    return `${items.join('、')}（かなり際どい ${pct(SENSITIVE_QUESTIONABLE_THRESHOLD)} 以上か、乳・股間のタグ ${pct(CERTAIN_TAG_THRESHOLD)} 以上でセンシティブ）`;
  }
  if (verdict === 'caution') return `${items.join('、')}（尻・下着のタグ ${pct(SUSPECT_TAG_THRESHOLD)} 以上で注意）`;
  return null;
}

const HOT_TAG_THRESHOLD = 0.5;
const MAX_RISKY_TAGS = 8;

const RISK_ORDER: TagXRisk[] = ['exposure', 'certain', 'suspect', 'safe'];

function riskyTags(tags: Record<string, number> | undefined): [string, number][] {
  return Object.entries(tags ?? {})
    .filter(([name]) => RISKY_TAGS.includes(name))
    .sort((a, b) => RISK_ORDER.indexOf(TAG_X_RISK[a[0]]!) - RISK_ORDER.indexOf(TAG_X_RISK[b[0]]!) || b[1] - a[1])
    .slice(0, MAX_RISKY_TAGS);
}

/** 詳細ページの `安全性` セクション。4 区分の 2×2 セル・タグを常に出す。未採点は「未採点」。 */
export function SafetySection({ safety }: { safety: SafetyDetailData | null | undefined }) {
  if (!safety) {
    return (
      <p class="safety-row">
        <span class="safety-row-label">安全性</span> <span class="safety-unrated">未採点</span>
      </p>
    );
  }
  const reason = reasonText(safety.verdict, safety.reasons);
  const tags = riskyTags(safety.tags);
  return (
    <section class="safety-section">
      <div class="safety-head">
        <span class="safety-row-label">安全性</span>
        {safety.verdict === 'none' ? <span class="safety-ok">問題なし</span> : <SafetyBadge safety={safety} />}
      </div>
      {reason ? <p class="safety-reasons">{reason}</p> : null}
      <div class="safety-cells">
        {RATING_LABELS.map(([key, label]) => {
          const limited = key === 'questionable';
          const over = limited && safety.rating[key] >= SENSITIVE_QUESTIONABLE_THRESHOLD;
          return (
            <div
              class={`safety-cell${over ? ' over' : ''}`}
              style={`--c:var(${RATING_COLOR_VARS[key]});--p:${safety.rating[key] * 100}%`}
            >
              {limited ? <span class="safety-cell-tick" style={`left:${SENSITIVE_QUESTIONABLE_THRESHOLD * 100}%`} /> : null}
              <span class="safety-cell-label">{label}</span>
              <span class="safety-cell-value safety-num">{fmtPct(safety.rating[key])}</span>
              {limited ? <span class="safety-cell-limit safety-num">/ {pct(SENSITIVE_QUESTIONABLE_THRESHOLD)}</span> : null}
            </div>
          );
        })}
      </div>
      {tags.length > 0 ? (
        <div class="safety-tags">
          {tags.map(([name, value]) => (
            <span class={`safety-tag risk-${TAG_X_RISK[name]}${value >= HOT_TAG_THRESHOLD ? ' hot' : ''}`}>
              {name}
              <span class="safety-num">{Math.round(value * 100)}%</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** サムネイル下の細帯。判定が none のときだけ、ホバーで見える「際 93.1%」を添える。未採点は何も出さない。 */
export function SafetyStrip({ safety }: { safety: SafetyView | null | undefined }) {
  if (!safety) return null;
  return (
    <>
      <RatingBar rating={safety.rating} variant="strip" />
      {safety.verdict === 'none' ? <span class="card-safety-pct">際 {fmtPct(safety.rating.sensitive)}</span> : null}
    </>
  );
}

/** 比較ページの各画像の下に置く 1 行。先頭の画像（base）からの「少し際どい」の増減を pt で出す。 */
export function SafetyCompareCaption({
  safety,
  base,
  isBase,
}: {
  safety: SafetyView | null | undefined;
  base: SafetyView | null | undefined;
  isBase: boolean;
}) {
  if (!safety) return null;
  const delta = isBase || !base ? null : (safety.rating.sensitive - base.rating.sensitive) * 100;
  return (
    <div class="safety-compare">
      <RatingBar rating={safety.rating} variant="mini" />
      <span class="safety-num">{fmtPct(safety.rating.sensitive)}</span>
      {delta === null ? (
        <span class="safety-delta">—</span>
      ) : (
        <span class={`safety-delta ${delta < 0 ? 'down' : 'up'}`}>
          {delta > 0 ? '+' : ''}
          {delta.toFixed(1)}pt
        </span>
      )}
    </div>
  );
}
