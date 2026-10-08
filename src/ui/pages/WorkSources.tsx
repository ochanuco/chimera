import { Layout } from '../layout';
import type { WorkSource } from '../../lib/ui-queries';

export interface WorkSourceFilters {
  rating?: 'good';
  recipe?: string;
  page: number;
}

function href(filters: WorkSourceFilters, patch: Partial<WorkSourceFilters>): string {
  const next = { ...filters, page: 1, ...patch };
  const params = new URLSearchParams();
  if (next.rating) params.set('rating', next.rating);
  if (next.recipe) params.set('recipe', next.recipe);
  if (next.page > 1) params.set('page', String(next.page));
  const query = params.toString();
  return query ? `/work?${query}` : '/work';
}

/** `/work`: pick a raw Generation to open in the workbench. */
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
      <h1>元絵を選ぶ</h1>
      <p class="work-lead">選んだ絵を起点に、描き直し・光・部分・納品・ボケを 1 フェーズずつ積みます。</p>
      <div class="work-filters">
        <div class="work-filter-group" aria-label="評価">
          <a class={`wb-pill${filters.rating ? '' : ' wb-pill-on'}`} href={href(filters, { rating: undefined })}>
            すべて
          </a>
          <a class={`wb-pill${filters.rating === 'good' ? ' wb-pill-on' : ''}`} href={href(filters, { rating: 'good' })}>
            good だけ
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
        <p class="empty-state">元絵がありません。</p>
      ) : (
        <div class="work-grid">
          {items.map((g) => (
            <a class="work-source" href={`/work/${g.short_id}`}>
              <img src={`/g/${g.short_id}/preview`} alt={g.short_id} loading="lazy" />
              <span class="work-source-meta">
                <span class="work-source-id">{g.short_id}</span>
                <span class={`work-rating work-rating-${g.rating ?? 'none'}`}>{g.rating ?? '未評価'}</span>
              </span>
              <span class="work-source-recipe">{g.recipe ?? '-'}</span>
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
