const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Rating group + bookmark row used by Generation Detail's full page. */
export function RatingBookmark({
  id,
  rating,
  bookmark,
}: {
  id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
}) {
  return (
    <div class="card-top-row">
      <div class="rating-group" data-generation-id={id} data-current={rating ?? ''}>
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
