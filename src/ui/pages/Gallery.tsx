import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';

export interface GalleryItem extends GenerationCardData {
  tags: string[];
}

export interface GalleryFilters {
  character?: string;
  tag?: string;
  from?: string;
  to?: string;
  rating?: string;
  bookmark?: string;
  limit: number;
  offset: number;
}

function pageLink(filters: GalleryFilters, offset: number): string {
  const params = new URLSearchParams();
  if (filters.character) params.set('character', filters.character);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.bookmark) params.set('bookmark', filters.bookmark);
  params.set('limit', String(filters.limit));
  params.set('offset', String(offset));
  return `/gallery?${params.toString()}`;
}

export function GalleryPage({
  characters,
  items,
  total,
  filters,
}: {
  characters: { id: string; name: string }[];
  items: GalleryItem[];
  total: number;
  filters: GalleryFilters;
}) {
  const hasPrev = filters.offset > 0;
  const hasNext = filters.offset + filters.limit < total;

  return (
    <Layout title="Gallery">
      <h1>Gallery</h1>
      <form class="filter-form" method="get" action="/gallery">
        <label>
          Character
          <select name="character">
            <option value="">All</option>
            {characters.map((ch) => (
              <option value={ch.id} selected={filters.character === ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <input type="text" name="tag" value={filters.tag ?? ''} placeholder="tag name" />
        </label>
        <label>
          Date from
          <input type="date" name="from" value={filters.from ?? ''} />
        </label>
        <label>
          Date to
          <input type="date" name="to" value={filters.to ?? ''} />
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
        <button type="submit">Search</button>
      </form>

      <datalist id="tag-suggestions"></datalist>

      {items.length === 0 ? (
        <p class="empty-state">No generations match this filter.</p>
      ) : (
        <div class="grid">
          {items.map((g) => (
            <GenerationCard g={g} />
          ))}
        </div>
      )}

      <div class="pagination">
        <a href={hasPrev ? pageLink(filters, Math.max(0, filters.offset - filters.limit)) : '#'} class={hasPrev ? '' : 'disabled'}>
          ← Prev
        </a>
        <span>
          {filters.offset + 1}–{Math.min(filters.offset + filters.limit, total)} of {total}
        </span>
        <a href={hasNext ? pageLink(filters, filters.offset + filters.limit) : '#'} class={hasNext ? '' : 'disabled'}>
          Next →
        </a>
      </div>

      <div id="compare-bar" class="compare-bar hidden">
        <span id="compare-count">Compare (0)</span>
        <a id="compare-link" class="compare-go" href="#">
          Compare
        </a>
      </div>
    </Layout>
  );
}
