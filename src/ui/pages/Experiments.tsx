import { Layout } from '../layout';
import { EXPERIMENT_STATUSES } from '../../lib/experiment-status';

export { EXPERIMENT_STATUSES };

export interface ExperimentListItem {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  note: string | null;
  status: string;
  base_recipe: string | null;
  character_id: string | null;
  bookmark: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  character: { id: string; name: string } | null;
  run_count: number;
  latest_run: { id: string; run_index: number; created_at: string; evaluation_overall: string | null } | null;
}

/** Small local badge used by the Experiments list and detail pages. Colored via CSS `[data-value]` rules. */
export function StatusBadge({ value }: { value: string }) {
  return (
    <span class="status-badge" data-value={value}>
      {value}
    </span>
  );
}

export function ExperimentsPage({ items, status }: { items: ExperimentListItem[]; status?: string }) {
  return (
    <Layout title="Experiments">
      <h1>Experiments</h1>
      <form class="filter-form" method="get" action="/experiments">
        <label>
          Status
          <select name="status">
            <option value="" selected={!status}>
              All
            </option>
            {EXPERIMENT_STATUSES.map((s) => (
              <option value={s} selected={status === s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Search</button>
      </form>

      {items.length === 0 ? (
        <p class="empty-state">No experiments yet.</p>
      ) : (
        <table class="kv-table">
          {items.map((e) => (
            <tr>
              <td>
                <a href={`/experiments/${e.short_id}`}>{e.name}</a>
              </td>
              <td>{e.character ? e.character.name : '-'}</td>
              <td>
                <StatusBadge value={e.status} />
              </td>
              <td>{e.run_count} runs</td>
              <td>{e.latest_run ? `#${e.latest_run.run_index}` : '-'}</td>
              <td>{e.latest_run && e.latest_run.evaluation_overall ? <StatusBadge value={e.latest_run.evaluation_overall} /> : '-'}</td>
              <td>{e.updated_at}</td>
              <td>
                <button
                  type="button"
                  class="bookmark-btn"
                  data-kind="experiments"
                  data-id={e.id}
                  data-bookmarked={e.bookmark ? 'true' : 'false'}
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
