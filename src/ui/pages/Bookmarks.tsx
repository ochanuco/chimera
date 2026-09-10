import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { BatchRow, type BatchRowData } from '../components/BatchRow';

export interface BookmarkedExperiment {
  id: string;
  name: string;
  created_at: string;
}

export function BookmarksPage({
  path,
  generations,
  batches,
  experiments,
}: {
  path: string;
  generations: GenerationCardData[];
  batches: BatchRowData[];
  experiments: BookmarkedExperiment[];
}) {
  return (
    <Layout title="Bookmarks" path={path}>
      <h1>Bookmarks</h1>
      <datalist id="tag-suggestions"></datalist>

      <section class="bookmark-section">
        <h2>Generations</h2>
        {generations.length === 0 ? (
          <p class="empty-state">No bookmarked generations.</p>
        ) : (
          <div class="grid">
            {generations.map((g) => (
              <GenerationCard g={{ ...g, tags: [] }} showCompare={false} />
            ))}
          </div>
        )}
      </section>

      <section class="bookmark-section">
        <h2>Batches</h2>
        {batches.length === 0 ? (
          <p class="empty-state">No bookmarked batches.</p>
        ) : (
          batches.map((b) => <BatchRow b={b} />)
        )}
      </section>

      <section class="bookmark-section">
        <h2>Experiments</h2>
        {experiments.length === 0 ? (
          <p class="empty-state">No bookmarked experiments.</p>
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
