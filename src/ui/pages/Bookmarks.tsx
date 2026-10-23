import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { ViewSwitch, type GalleryView } from '../components/ViewSwitch';

export interface BookmarkedExperiment {
  id: string;
  name: string;
  created_at: string;
}

/** Card grid content, shared by the full page and the `partial=1` infinite-scroll fragment. */
export function BookmarkCards({ generations, nextCursor, view }: { generations: GenerationCardData[]; nextCursor: string | null; view: GalleryView }) {
  const params = new URLSearchParams({ view });
  if (nextCursor) params.set('cursor', nextCursor);
  return (
    <>
      {generations.map((g) => (
        <GenerationCard g={g} />
      ))}
      {nextCursor ? (
        <a class="load-more" href={`/bookmarks?${params.toString()}`}>
          もっと見る
        </a>
      ) : null}
    </>
  );
}

export function BookmarksPage({
  path,
  generations,
  nextCursor,
  experiments,
  view,
}: {
  path: string;
  generations: GenerationCardData[];
  nextCursor: string | null;
  experiments: BookmarkedExperiment[];
  view: GalleryView;
}) {
  return (
    <Layout title="ブックマーク" path={path}>
      <h1>ブックマーク</h1>
      <datalist id="tag-suggestions"></datalist>

      <section class="bookmark-section">
        <h2>実験</h2>
        {experiments.length === 0 ? (
          <p class="empty-state">実験のブックマークはありません</p>
        ) : (
          <ul>
            {experiments.map((e) => (
              <li>
                <a href={`/experiments/${e.id}`}>{e.name}</a> ({e.created_at})
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="bookmark-section">
        <h2>Generations</h2>
        <ViewSwitch basePath="/bookmarks" current={view} params={new URLSearchParams()} />
        {generations.length === 0 ? (
          <p class="empty-state">Generation のブックマークはありません</p>
        ) : (
          <div class="grid grid-gallery" data-gallery-grid>
            <BookmarkCards generations={generations} nextCursor={nextCursor} view={view} />
          </div>
        )}
      </section>

    </Layout>
  );
}
