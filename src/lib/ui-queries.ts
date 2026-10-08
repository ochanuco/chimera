// Management API does not expose bookmark filtering for experiments, so the GUI queries D1 directly here.
import type { ExperimentRow } from '../types';

export interface BookmarkedExperiment {
  id: string;
  name: string;
  created_at: string;
}

export async function listBookmarkedExperiments(db: D1Database): Promise<BookmarkedExperiment[]> {
  const { results } = await db
    .prepare('SELECT * FROM experiments WHERE bookmark = 1 ORDER BY created_at DESC')
    .all<ExperimentRow>();
  return (results ?? []).map((r) => ({ id: r.id, name: r.name, created_at: r.created_at }));
}

export const WORK_SOURCES_PAGE_SIZE = 24;

export interface WorkSource {
  id: string;
  short_id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  recipe: string | null;
  created_at: string;
}

/** Raw Generations (no refines_generation_id), newest first — the workbench's picker. `rating` narrows to one rating; `recipe` to one request recipe. */
export async function listWorkSources(
  db: D1Database,
  filters: { rating?: string; recipe?: string; offset: number },
): Promise<{ items: WorkSource[]; hasMore: boolean; recipes: string[] }> {
  const conditions = ['g.refines_generation_id IS NULL'];
  const binds: unknown[] = [];
  if (filters.rating) {
    conditions.push('g.rating = ?');
    binds.push(filters.rating);
  }
  if (filters.recipe) {
    conditions.push('r.recipe = ?');
    binds.push(filters.recipe);
  }
  const { results } = await db
    .prepare(
      `SELECT g.id, g.short_id, g.rating, g.created_at, r.recipe
       FROM generations g LEFT JOIN requests r ON r.id = g.request_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY g.created_at DESC, g.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, WORK_SOURCES_PAGE_SIZE + 1, filters.offset)
    .all<WorkSource>();
  const rows = results ?? [];
  const recipeRows = await db
    .prepare(
      `SELECT DISTINCT r.recipe FROM generations g JOIN requests r ON r.id = g.request_id
       WHERE g.refines_generation_id IS NULL AND r.recipe IS NOT NULL ORDER BY r.recipe`,
    )
    .all<{ recipe: string }>();
  return {
    items: rows.slice(0, WORK_SOURCES_PAGE_SIZE),
    hasMore: rows.length > WORK_SOURCES_PAGE_SIZE,
    recipes: (recipeRows.results ?? []).map((r) => r.recipe),
  };
}
