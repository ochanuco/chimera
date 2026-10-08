/**
 * The id / detail link / rating / bookmark box under an image pane's caption, shared by the workbench and the reroll screen.
 * It is rendered hidden and filled by `wbRenderCapActions` (src/ui/static.ts) once the pane has a Generation.
 */
export function CapActions({ side, work = false }: { side: string; work?: boolean }) {
  return (
    <div class="wb-cap-actions" data-wb-cap-actions={side} hidden>
      <span class="copy-id-btn copy-id-text" data-wb-cap-id role="button" tabindex={0}></span>
      <a class="wb-cap-link" data-wb-cap-link>
        /g/
      </a>
      {work ? (
        <a class="wb-cap-link" data-wb-cap-work title="ワークベンチで開く">
          ワークベンチへ
        </a>
      ) : null}
      <div class="rating-group wb-rating" role="group" aria-label="評価">
        {(['bad', 'neutral', 'good'] as const).map((r) => (
          <button type="button" class="rate-btn" data-rating={r}>
            {r}
          </button>
        ))}
      </div>
      <button type="button" class="bookmark-btn" data-wb-bookmark data-kind="generations" data-bookmarked="false" aria-label="ブックマーク">
        🔖
      </button>
    </div>
  );
}
