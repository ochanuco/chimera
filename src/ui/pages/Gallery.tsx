import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { ViewSwitch, type GalleryView } from '../components/ViewSwitch';

export interface GalleryItem extends GenerationCardData {
  tags: string[];
}

export interface GalleryFilters {
  view: GalleryView;
  bad: boolean;
  ids?: string;
  tag?: string;
  rating?: string;
  bookmark?: string;
  published?: string;
}

/** Every currently-active query param (view/bad included), used as the base for the view/bad/load-more links. */
function activeParams(filters: GalleryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view !== 'raw') params.set('view', filters.view);
  if (filters.bad) params.set('bad', '1');
  if (filters.ids) params.set('ids', filters.ids);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.bookmark) params.set('bookmark', filters.bookmark);
  if (filters.published) params.set('published', filters.published);
  return params;
}

/** Gallery live insertion (docs/ui.md「Gallery」) is active only when no ids / panel filter narrows the grid — `view`/`bad` don't disqualify it. */
function galleryLiveEligible(filters: GalleryFilters): boolean {
  return !filters.ids && !filters.tag && !filters.rating && !filters.bookmark && !filters.published;
}

function badToggleHref(filters: GalleryFilters): string {
  const params = activeParams(filters);
  if (filters.bad) params.delete('bad');
  else params.set('bad', '1');
  return `/gallery?${params.toString()}`;
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="6" cy="4" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
      <circle cx="11" cy="8" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
      <circle cx="5" cy="12" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
    </svg>
  );
}

function GalleryToolbar({ filters }: { filters: GalleryFilters }) {
  const hasActiveFilter = Boolean(filters.ids || filters.tag || filters.rating || filters.bookmark || filters.published);
  return (
    <div class="gallery-toolbar">
      <ViewSwitch basePath="/gallery" current={filters.view} params={activeParams(filters)} />
      <a class="bad-toggle" href={badToggleHref(filters)} aria-pressed={filters.bad ? 'true' : 'false'}>
        <span class="bad-toggle-box" aria-hidden="true"></span>
        bad も表示
      </a>
      <details class="filter-panel" open={hasActiveFilter}>
        <summary>
          <FilterIcon />
          絞り込み
        </summary>
        <form class="filter-form" method="get" action="/gallery">
          <input type="hidden" name="view" value={filters.view} />
          {filters.bad ? <input type="hidden" name="bad" value="1" /> : null}
          <label>
            ID（複数可）
            <textarea name="ids" rows={1}>
              {filters.ids ?? ''}
            </textarea>
          </label>
          <label>
            Tag
            <input type="text" name="tag" value={filters.tag ?? ''} placeholder="tag name" />
          </label>
          <label>
            Rating
            <select name="rating">
              <option value="">All</option>
              {(['good', 'neutral', 'bad'] as const).map((r) => (
                <option value={r} selected={filters.rating === r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="bookmark" value="true" checked={filters.bookmark === 'true'} />
            Bookmarked only
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="published" value="true" checked={filters.published === 'true'} />
            公開済みのみ
          </label>
          <button type="submit">Search</button>
        </form>
      </details>
    </div>
  );
}

function LoadMoreLink({ cursor, filters }: { cursor: string; filters: GalleryFilters }) {
  const params = activeParams(filters);
  params.set('cursor', cursor);
  return (
    <a class="load-more" href={`/gallery?${params.toString()}`}>
      もっと見る
    </a>
  );
}

/** Card grid content, shared by the full page render and the `partial=1` infinite-scroll fragment. */
export function GalleryCards({
  items,
  nextCursor,
  filters,
}: {
  items: GalleryItem[];
  nextCursor: string | null;
  filters: GalleryFilters;
}) {
  return (
    <>
      {items.map((g) => (
        <GenerationCard g={g} />
      ))}
      {nextCursor ? <LoadMoreLink cursor={nextCursor} filters={filters} /> : null}
    </>
  );
}

export function GalleryPage({
  path,
  items,
  nextCursor,
  filters,
}: {
  path: string;
  items: GalleryItem[];
  nextCursor: string | null;
  filters: GalleryFilters;
}) {
  return (
    <Layout title="Gallery" path={path}>
      <h1>Gallery</h1>
      <GalleryToolbar filters={filters} />

      <datalist id="tag-suggestions"></datalist>

      {items.length === 0 ? (
        <p class="empty-state">No generations match this filter.</p>
      ) : (
        <div
          class="grid"
          data-gallery-grid
          data-hide-bad={!filters.bad && !filters.ids ? 'true' : undefined}
          data-gallery-view={filters.view}
          data-gallery-live={galleryLiveEligible(filters) ? 'true' : undefined}
        >
          <GalleryCards items={items} nextCursor={nextCursor} filters={filters} />
        </div>
      )}
    </Layout>
  );
}
