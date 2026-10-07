import {
  BLOCK_TAG_THRESHOLD,
  CAUTION_SENSITIVE_THRESHOLD,
  RISKY_TAGS,
  SENSITIVE_QUESTIONABLE_THRESHOLD,
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
function exposureReasonText(reasons: string[]): string {
  const tags = reasons.map((r) => {
    const [name, value] = r.split(' ');
    return `${name} ${pct(Number(value))}`;
  });
  return `露出タグ ${tags.join(', ')}（${pct(BLOCK_TAG_THRESHOLD)} 以上で出さない）`;
}

interface GaugeProps {
  label: string;
  value: number;
  limit: number;
  colorVar: string;
  verdictLabel: string;
}

/** 判定に使う区分の値と閾値の距離。閾値の 5pt 手前からは強調する。 */
function Gauge({ label, value, limit, colorVar, verdictLabel }: GaugeProps) {
  const left = limit - value;
  const gap =
    left > 0
      ? `あと ${(left * 100).toFixed(1)}pt で${verdictLabel}`
      : `${verdictLabel}の閾値を ${(-left * 100).toFixed(1)}pt 超過`;
  const near = left > 0 && left < 0.05;
  return (
    <div class="safety-gauge">
      <span class="safety-label">{label}</span>
      <div class="safety-track">
        <div class="safety-fill" style={`width:${value * 100}%;background:var(${colorVar})`} />
        <div class="safety-tick" style={`left:calc(${limit * 100}% - 1px)`} data-label={`${Math.round(limit * 100)}%`} />
      </div>
      <span class="safety-num">{fmtPct(value)}</span>
      <span class={`safety-gap${near ? ' near' : ''}`}>{gap}</span>
    </div>
  );
}

const HOT_TAG_THRESHOLD = 0.5;
const MAX_RISKY_TAGS = 8;

function riskyTags(tags: Record<string, number> | undefined): [string, number][] {
  return Object.entries(tags ?? {})
    .filter(([name]) => RISKY_TAGS.includes(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RISKY_TAGS);
}

/** 詳細ページの `安全性` セクション。4 区分の帯・閾値つきメーター・効いていそうなタグを常に出す。未採点は「未採点」。 */
export function SafetySection({ safety }: { safety: SafetyDetailData | null | undefined }) {
  if (!safety) {
    return (
      <p class="safety-row">
        <span class="safety-row-label">安全性</span> <span class="safety-unrated">未採点</span>
      </p>
    );
  }
  const reason = safety.verdict === 'block' ? exposureReasonText(safety.reasons) : null;
  const tags = riskyTags(safety.tags);
  return (
    <section class="safety-section">
      <div class="safety-head">
        <span class="safety-row-label">安全性</span>
        {safety.verdict === 'none' ? <span class="safety-ok">問題なし</span> : <SafetyBadge safety={safety} />}
      </div>
      {reason ? <p class="safety-reasons">{reason}</p> : null}
      <RatingBar rating={safety.rating} variant="stack" />
      <div class="safety-legend">
        {RATING_LABELS.map(([key, label]) => (
          <span>
            <i style={`background:var(${RATING_COLOR_VARS[key]})`} />
            {label} <b class="safety-num">{fmtPct(safety.rating[key])}</b>
          </span>
        ))}
      </div>
      <div class="safety-gauges">
        <Gauge
          label="少し際どい"
          value={safety.rating.sensitive}
          limit={CAUTION_SENSITIVE_THRESHOLD}
          colorVar="--r-sensitive"
          verdictLabel="注意"
        />
        <Gauge
          label="かなり際どい"
          value={safety.rating.questionable}
          limit={SENSITIVE_QUESTIONABLE_THRESHOLD}
          colorVar="--r-questionable"
          verdictLabel="センシティブ"
        />
      </div>
      {tags.length > 0 ? (
        <div>
          <div class="safety-label safety-tags-title">効いていそうなタグ</div>
          <div class="safety-tags">
            {tags.map(([name, value]) => (
              <span class={`safety-tag${value >= HOT_TAG_THRESHOLD ? ' hot' : ''}`}>
                {name}
                <span class="safety-num">{Math.round(value * 100)}%</span>
              </span>
            ))}
          </div>
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
      {safety.verdict === 'none' ? <span class="safety-ok">問題なし</span> : <SafetyBadge safety={safety} />}
    </div>
  );
}
