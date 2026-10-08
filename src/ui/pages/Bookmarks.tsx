import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { ViewSwitch, type GalleryView } from '../components/ViewSwitch';

export interface BookmarkedExperiment {
  id: string;
  name: string;
  created_at: string;
}

export function BookmarksPage({
  path,
  generations,
  experiments,
  view,
}: {
  path: string;
  generations: GenerationCardData[];
  experiments: BookmarkedExperiment[];
  view: GalleryView;
}) {
  return (
    <Layout title="ブックマーク" path={path}>
      <h1>ブックマーク</h1>
      <datalist id="tag-suggestions"></datalist>

      <section class="bookmark-section">
        <h2>Generations</h2>
        <ViewSwitch basePath="/bookmarks" current={view} params={new URLSearchParams()} />
        {generations.length === 0 ? (
          <p class="empty-state">Generation のブックマークはありません</p>
        ) : (
          <div class="grid grid-gallery">
            {generations.map((g) => (
              <GenerationCard g={g} />
            ))}
          </div>
        )}
      </section>

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
    </Layout>
  );
}
