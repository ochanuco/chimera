const RATINGS = ['bad', 'neutral', 'good'] as const;

/**
 * Rating group + bookmark row shared by Generation Detail's full page and the Lightbox panel.
 * `size="lg"` renders the larger lightbox variant (docs/ui.md「Lightbox」).
 */
export function RatingBookmark({
  id,
  rating,
  bookmark,
  size = 'default',
}: {
  id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  size?: 'default' | 'lg';
}) {
  return (
    <div class="card-top-row">
      <div class={`rating-group${size === 'lg' ? ' rating-group-lg' : ''}`} data-generation-id={id} data-current={rating ?? ''}>
        {RATINGS.map((r) => (
          <button type="button" class={`rate-btn${rating === r ? ' active' : ''}`} data-rating={r}>
            {r}
          </button>
        ))}
      </div>
      <button type="button" class="bookmark-btn" data-kind="generations" data-id={id} data-bookmarked={bookmark ? 'true' : 'false'}>
        🔖
      </button>
    </div>
  );
}
