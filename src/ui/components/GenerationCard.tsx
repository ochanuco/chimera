export interface FinalizeRequestBadgeData {
  id: string;
  kind: 'finalize' | 'repair' | 'masked_redraw';
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
  image_width?: number | null;
  image_height?: number | null;
  image_size?: number | null;
  /** short_id of the raw Generation this card's Batch refines (finalize/repair/masked_redraw output), or null/absent for a raw Generation. */
  refines_generation_short_id?: string | null;
  /** 少なくとも1件の Publication を持つか (docs/domain-model.md#publication)。 */
  published?: boolean;
  /** このGenerationを対象にした最新のfinalize/repair/masked_redraw request (docs/ui.md「Gallery」進捗ピル)。無い/未対応の一覧はundefined。 */
  finalize_request?: FinalizeRequestBadgeData | null;
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

/** kind の表示ラベル。masked_redraw だけ語間にスペースが入る。 */
function finalizeKindLabel(kind: FinalizeRequestBadgeData['kind']): string {
  return kind === 'repair' ? 'repair' : kind === 'masked_redraw' ? 'masked redraw' : 'finalize';
}

/**
 * サムネイル左上の進捗ピル (docs/ui.md「Gallery」)。live更新 (`[data-request-id]`) の
 * 対象なので、appJsのsetFinalizeBadgeTextが再現するのと同じDOM構造 (`kind · status` +
 * done時は`.card-finalize-result`の子span) で組む。
 */
function FinalizeBadge({ r }: { r: FinalizeRequestBadgeData }) {
  const label = finalizeKindLabel(r.kind);
  return (
    <span
      class={`card-finalize-badge request-status-${r.status}`}
      data-request-id={r.id}
      data-request-status={r.status}
      data-request-kind={r.kind}
    >
      {label} ·{' '}
      {r.status === 'done' ? (
        <>
          done → <span class="card-finalize-result">{r.result_short_id ?? ''}</span>
        </>
      ) : (
        r.status
      )}
    </span>
  );
}

/**
 * Card used in Gallery / Batch Detail / Bookmarks generation grids: thumbnail (with optional
 * `from <short_id>` / 公開済み overlays) + a single row of rating + bookmark. Everything else
 * (short_id link, copy button, image meta, tags, compare selection) lives in the lightbox instead.
 */
export function GenerationCard({ g }: { g: GenerationCardData }) {
  const hasTopBadges = Boolean(g.refines_generation_short_id) || Boolean(g.finalize_request);
  return (
    <div class="card">
      <a class="thumb-link" href={`/g/${g.short_id}`} data-short-id={g.short_id}>
        <img class="thumb-fg" src={g.thumbnail_url} alt={g.short_id} loading="lazy" />
        {hasTopBadges ? (
          <div class="thumb-badges-top">
            {g.refines_generation_short_id ? (
              <span class="card-from-badge">
                from <span class="card-from-badge-id">{g.refines_generation_short_id}</span>
              </span>
            ) : null}
            {g.finalize_request ? <FinalizeBadge r={g.finalize_request} /> : null}
          </div>
        ) : null}
        {g.published ? (
          <span class="card-published-pill">
            <SendIcon /> 公開済み
          </span>
        ) : null}
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
          <button
            type="button"
            class="bookmark-btn card-bookmark-btn"
            data-kind="generations"
            data-id={g.id}
            data-bookmarked={g.bookmark ? 'true' : 'false'}
            title="bookmark"
          >
            🔖
          </button>
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
