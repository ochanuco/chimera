const RATINGS = ['bad', 'neutral', 'good'] as const;

/** Generation Detail の評価とブックマークの行。ブックマークは線の図形で、済みは塗り（CSS が data-bookmarked で切り替える）。 */
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
    <div class="gd-marks">
      <div class="rating-group" role="group" aria-label="評価" data-generation-id={id} data-current={rating ?? ''}>
        {RATINGS.map((r) => (
          <button type="button" class={`rate-btn${rating === r ? ' active' : ''}`} data-rating={r}>
            {r}
          </button>
        ))}
      </div>
      <button
        type="button"
        class="bookmark-btn gd-icon-btn"
        data-kind="generations"
        data-id={id}
        data-bookmarked={bookmark ? 'true' : 'false'}
        aria-label="ブックマーク"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
      </button>
    </div>
  );
}
