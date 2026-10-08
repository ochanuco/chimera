import { Layout } from '../layout';
import type { WorkSource, WorkSourceState } from '../../lib/ui-queries';

export interface WorkSourceFilters {
  state?: WorkSourceState;
  recipe?: string;
  page: number;
}

function href(filters: WorkSourceFilters, patch: Partial<WorkSourceFilters>): string {
  const next = { ...filters, page: 1, ...patch };
  const params = new URLSearchParams();
  if (next.state) params.set('state', next.state);
  if (next.recipe) params.set('recipe', next.recipe);
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `/work?${query}` : '/work';
}

const STATE_LABEL: Record<WorkSourceState, string> = { wip: 'しかかり', done: '完成' };

/** `/work`: raw Generations that have been worked on, to resume in the workbench. */
export function WorkSourcesPage({
  path,
  items,
  recipes,
  filters,
  hasMore,
}: {
  path: string;
  items: WorkSource[];
  recipes: string[];
  filters: WorkSourceFilters;
  hasMore: boolean;
}) {
  return (
    <Layout title="ワークベンチ" path={path}>
      <h1>ワークベンチ</h1>
      <div class="work-filters">
        <div class="work-filter-group" aria-label="状態">
          <a class={`wb-pill${filters.state ? '' : ' wb-pill-on'}`} href={href(filters, { state: undefined })}>
            すべて
          </a>
          <a class={`wb-pill${filters.state === 'wip' ? ' wb-pill-on' : ''}`} href={href(filters, { state: 'wip' })}>
            しかかり
          </a>
          <a class={`wb-pill${filters.state === 'done' ? ' wb-pill-on' : ''}`} href={href(filters, { state: 'done' })}>
            完成
          </a>
        </div>
        {recipes.length > 0 ? (
          <div class="work-filter-group" aria-label="recipe">
            <a class={`wb-pill${filters.recipe ? '' : ' wb-pill-on'}`} href={href(filters, { recipe: undefined })}>
              全 recipe
            </a>
            {recipes.map((recipe) => (
              <a class={`wb-pill${filters.recipe === recipe ? ' wb-pill-on' : ''}`} href={href(filters, { recipe })}>
                {recipe}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p class="empty-state">作業中の絵がありません</p>
      ) : (
        <div class="work-grid">
          {items.map((g) => (
            <a class="work-source" href={`/work/${g.short_id}`}>
              <img src={`/g/${g.short_id}/preview`} alt={g.short_id} loading="lazy" />
              <span class="work-source-meta">
                <span class="work-source-id">{g.short_id}</span>
                <span class={`work-state work-state-${g.state}`}>{STATE_LABEL[g.state]}</span>
              </span>
              <span class="work-source-meta">
                <span class="work-source-recipe">{g.recipe ?? '-'}</span>
                <span class={`work-rating work-rating-${g.rating ?? 'none'}`}>{g.rating ?? '未評価'}</span>
              </span>
            </a>
          ))}
        </div>
      )}
      <nav class="work-pager" aria-label="ページ">
        {filters.page > 1 ? (
          <a class="wb-pill" rel="prev" href={href(filters, { page: filters.page - 1 })}>
            前へ
          </a>
        ) : null}
        {hasMore ? (
          <a class="wb-pill" rel="next" href={href(filters, { page: filters.page + 1 })}>
            次へ
          </a>
        ) : null}
      </nav>
    </Layout>
  );
}
