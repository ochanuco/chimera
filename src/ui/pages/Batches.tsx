import { Layout } from '../layout';
import { BatchRow, type BatchRowData } from '../components/BatchRow';

export function BatchesPage({
  path,
  items,
  bookmarkOnly,
}: {
  path: string;
  items: BatchRowData[];
  bookmarkOnly: boolean;
}) {
  return (
    <Layout title="Batches" path={path}>
      <h1>Batches</h1>
      <form class="filter-form" method="get" action="/batches">
        <label class="checkbox-field">
          <input type="checkbox" name="bookmark" value="true" checked={bookmarkOnly} />
          Bookmarked only
        </label>
        <button type="submit">Filter</button>
      </form>

      {items.length === 0 ? (
        <p class="empty-state">No batches yet.</p>
      ) : (
        <div>
          {items.map((b) => (
            <BatchRow b={b} />
          ))}
        </div>
      )}
    </Layout>
  );
}
