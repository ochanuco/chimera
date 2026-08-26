import { Layout } from '../layout';

export interface StoryListItem {
  id: string;
  name: string;
  description: string | null;
  bookmark: boolean;
  batch_count: number;
}

export function StoriesPage({ items }: { items: StoryListItem[] }) {
  return (
    <Layout title="Stories">
      <h1>Stories</h1>
      {items.length === 0 ? (
        <p class="empty-state">No stories yet.</p>
      ) : (
        <table class="kv-table">
          {items.map((s) => (
            <tr>
              <td>
                <a href={`/stories/${s.id}`}>{s.name}</a>
              </td>
              <td>{s.description ?? '-'}</td>
              <td>{s.batch_count} batches</td>
              <td>
                <button
                  type="button"
                  class="bookmark-btn"
                  data-kind="stories"
                  data-id={s.id}
                  data-bookmarked={s.bookmark ? 'true' : 'false'}
                >
                  🔖
                </button>
              </td>
            </tr>
          ))}
        </table>
      )}
    </Layout>
  );
}
