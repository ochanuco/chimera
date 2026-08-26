export interface GenerationCardData {
  id: string;
  short_id: string;
  image_url: string;
  thumbnail_url: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  tags?: string[];
}

const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Card used in Gallery / Batch Detail / Bookmarks generation grids. */
export function GenerationCard({ g, showCompare = true }: { g: GenerationCardData; showCompare?: boolean }) {
  return (
    <div class="card">
      <a class="thumb-link" href={`/g/${g.short_id}`}>
        <img src={g.thumbnail_url} alt={g.short_id} loading="lazy" />
      </a>
      <div class="card-body">
        <div class="card-top-row">
          <a class="short-id-link" href={`/g/${g.short_id}`}>
            {g.short_id}
          </a>
          <button
            type="button"
            class="bookmark-btn"
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
        {g.tags && g.tags.length > 0 ? (
          <div class="tag-chips">
            {g.tags.map((t) => (
              <span class="tag-chip">#{t}</span>
            ))}
          </div>
        ) : null}
        <form class="tag-add-form" data-kind="generations" data-id={g.id}>
          <input type="text" name="name" list="tag-suggestions" placeholder="add tag" />
          <button type="submit">+</button>
        </form>
        {showCompare ? (
          <label class="compare-check-row">
            <input type="checkbox" class="compare-check" value={g.short_id} /> compare
          </label>
        ) : null}
      </div>
    </div>
  );
}
