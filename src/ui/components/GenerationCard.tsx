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

/**
 * Card used in Gallery / Batch Detail / Bookmarks generation grids: thumbnail (with optional
 * `from <short_id>` / 公開済み overlays) + a single row of rating + bookmark. Everything else
 * (short_id link, copy button, image meta, tags, compare selection) lives in the lightbox instead.
 */
export function GenerationCard({ g }: { g: GenerationCardData }) {
  return (
    <div class="card">
      <a class="thumb-link" href={`/g/${g.short_id}`} data-short-id={g.short_id}>
        <img class="thumb-fg" src={g.thumbnail_url} alt={g.short_id} loading="lazy" />
        {g.refines_generation_short_id ? (
          <span class="card-from-badge">
            from <span class="card-from-badge-id">{g.refines_generation_short_id}</span>
          </span>
        ) : null}
        {g.published ? (
          <span class="card-published-pill">
            <SendIcon /> 公開済み
          </span>
        ) : null}
      </a>
      <div class="card-row">
        <div class="rating-group" data-generation-id={g.id} data-current={g.rating ?? ''}>
          {RATINGS.map((r) => (
            <button type="button" class={`rate-btn${g.rating === r ? ' active' : ''}`} data-rating={r}>
              {r}
            </button>
          ))}
        </div>
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
    </div>
  );
}
