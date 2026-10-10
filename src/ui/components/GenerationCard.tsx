import { slotKeyOf } from '../../lib/timeline';
import { SafetyBadge, SafetyStrip, type SafetyView } from './SafetyBadge';
import { REQUEST_KIND_LABELS } from './OptionControls';

export interface RequestBadgeData {
  id: string;
  kind: 'finalize' | 'redraw' | 'repair' | 'masked_redraw' | 'deliver' | 'dof';
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  result_short_id: string | null;
}

export interface GenerationCardData {
  id: string;
  short_id: string;
  image_url: string;
  thumbnail_url: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  tags?: string[];
  /** 指定があればカード root に `data-slot` (JST 15 分枠のキー) を付ける。Gallery のタイムラインが使う。 */
  created_at?: string;
  image_width?: number | null;
  image_height?: number | null;
  image_size?: number | null;
  /** short_id of the raw Generation this card's Generation refines (redraw/deliver/repair/masked_redraw output), or null/absent for a raw Generation. */
  refines_generation_short_id?: string | null;
  /** 少なくとも1件の Publication を持つか (docs/domain-model.md#publication)。 */
  published?: boolean;
  /** WD tagger の判定 (docs/ui.md「Gallery」安全性ピル)。未採点/未対応の一覧は null/undefined。 */
  safety?: SafetyView | null;
  /** このGenerationを対象にした最新のredraw/deliver/repair/masked_redraw request (docs/ui.md「Gallery」進捗ピル)。無い/未対応の一覧はundefined。 */
  refinement_request?: RequestBadgeData | null;
  /** このGenerationが pose の基準 render として pin されているか (docs/ui.md「Gallery」基準ピル)。無い/未対応の一覧はundefined。 */
  reference?: { recipe: string; pose: string } | null;
}

const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Small send-arrow icon for the 公開済み pill. Mirrors src/ui/pages/GenerationDetail.tsx's PublishIcon at a smaller size. */
function SendIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2L2 7.5L7 9L9 14L14 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M14 2L7 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

/** kind の表示ラベル。static.ts の requestKindLabel と同じ規則。 */
function refinementKindLabel(kind: RequestBadgeData['kind']): string {
  return REQUEST_KIND_LABELS[kind] ?? kind;
}

/** サムネイル左上の進捗ピル (docs/ui.md「Gallery」)。live更新 (`[data-request-id]`) の対象なので、
 * app.js の setRequestBadgeText が再現するのと同じ DOM 構造 (`kind · status` + done 時は `.card-request-result` の子span) で組む。 */
function RequestBadge({ r }: { r: RequestBadgeData }) {
  const label = refinementKindLabel(r.kind);
  return (
    <span
      class={`card-request-badge request-status-${r.status}`}
      data-request-id={r.id}
      data-request-status={r.status}
      data-request-kind={r.kind}
    >
      {label} ·{' '}
      {r.status === 'done' ? (
        <>
          done → <span class="card-request-result">{r.result_short_id ?? ''}</span>
        </>
      ) : (
        r.status
      )}
    </span>
  );
}

/** Card used in Gallery / Bookmarks / Compare generation grids: thumbnail (with optional
 * `from <short_id>` / 公開済み overlays) + a row of rating + bookmark. Everything else lives in Generation Detail, which the thumbnail links to. */
export function GenerationCard({ g }: { g: GenerationCardData }) {
  const hasTopBadges = Boolean(g.refines_generation_short_id) || Boolean(g.refinement_request);
  const slot = g.created_at ? slotKeyOf(g.created_at) : null;
  return (
    <div class="card" data-slot={slot ?? undefined}>
      <a class="thumb-link" href={`/g/${g.short_id}`} data-short-id={g.short_id}>
        <img class="thumb-fg" src={g.thumbnail_url} alt={g.short_id} loading="lazy" />
        {hasTopBadges ? (
          <div class="thumb-badges-top">
            {g.refines_generation_short_id ? (
              <span
                class="card-from-badge copy-id-btn copy-id-text"
                role="button"
                tabindex={0}
                data-copy-id={g.refines_generation_short_id}
                title={`Copy ${g.refines_generation_short_id}`}
                aria-label={`Copy ${g.refines_generation_short_id}`}
              >
                元 <span class="card-from-badge-id">{g.refines_generation_short_id}</span>
              </span>
            ) : null}
            {g.refinement_request ? <RequestBadge r={g.refinement_request} /> : null}
          </div>
        ) : null}
        {g.published || g.reference || (g.safety && g.safety.verdict !== 'none') ? (
          <div class="thumb-badges-bottom">
            <SafetyBadge safety={g.safety} />
            {g.published ? (
              <span class="card-published-pill">
                <SendIcon /> 公開済み
              </span>
            ) : null}
            {g.reference ? (
              <span class="card-reference-pill" title={`${g.reference.recipe} の ${g.reference.pose} の基準 render`}>
                基準 {g.reference.pose}
              </span>
            ) : null}
          </div>
        ) : null}
        <SafetyStrip safety={g.safety} />
      </a>
      <div class="card-row">
        <div class="card-id-row">
          <button
            type="button"
            class="copy-id-btn copy-id-text card-id"
            data-copy-id={g.short_id}
            title={`Copy ${g.short_id}`}
            aria-label={`Copy ${g.short_id}`}
          >
            {g.short_id}
          </button>
          <span class="card-id-actions">
            <a class="card-id-link" href={`/work/${g.short_id}`} title="ワークベンチで開く" aria-label={`Open ${g.short_id} in workbench`}>
              ⧉
            </a>
            {g.refines_generation_short_id ? null : (
              <a class="card-id-link" href={`/reroll/${g.short_id}`} title="リロール" aria-label={`Reroll ${g.short_id}`}>
                ↻
              </a>
            )}
            <button
              type="button"
              class="bookmark-btn card-bookmark-btn"
              data-kind="generations"
              data-id={g.id}
              data-bookmarked={g.bookmark ? 'true' : 'false'}
              title="ブックマーク"
            >
              🔖
            </button>
          </span>
        </div>
        <div class="rating-group" data-generation-id={g.id} data-current={g.rating ?? ''}>
          {RATINGS.map((r) => (
            <button type="button" class={`rate-btn${g.rating === r ? ' active' : ''}`} data-rating={r}>
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
