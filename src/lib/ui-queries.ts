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

export type WorkSourceState = 'wip' | 'done';

export interface WorkSource {
  id: string;
  short_id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  recipe: string | null;
  created_at: string;
  state: WorkSourceState;
  last_activity: string;
}

/** Same notion as `isDeliveredRequest` in requests.ts, expressed over a requests alias. */
const DELIVERED_SQL = `(r.kind IN ('deliver', 'dof', 'finalize')
  OR json_extract(r.parameters_json, '$.kind') IN ('deliver', 'hires-chain')
  OR (json_extract(r.parameters_json, '$.kind') = 'repair' AND json_extract(r.parameters_json, '$.deliver_only') = 1))`;

const WORKED_ON_CTE = `WITH RECURSIVE tree(root_id, id) AS (
  SELECT id, id FROM generations WHERE refines_generation_id IS NULL
  UNION ALL
  SELECT t.root_id, g.id FROM generations g JOIN tree t ON g.refines_generation_id = t.id
),
activity AS (
  SELECT t.root_id,
         SUM(CASE WHEN t.id != t.root_id THEN 1 ELSE 0 END) AS descendants,
         MAX(CASE WHEN t.id != t.root_id AND ${DELIVERED_SQL} THEN 1 ELSE 0 END) AS delivered,
         MAX(g.created_at) AS last_created
  FROM tree t JOIN generations g ON g.id = t.id LEFT JOIN requests r ON r.id = g.request_id
  GROUP BY t.root_id
),
worked AS (
  SELECT g.id, g.short_id, g.rating, g.created_at, q.recipe,
         CASE WHEN a.delivered = 1 THEN 'done' ELSE 'wip' END AS state,
         MAX(a.last_created, COALESCE(w.updated_at, a.last_created)) AS last_activity
  FROM activity a
  JOIN generations g ON g.id = a.root_id
  LEFT JOIN requests q ON q.id = g.request_id
  LEFT JOIN workbenches w ON w.root_generation_id = g.id
  WHERE a.descendants > 0 OR w.id IS NOT NULL
)`;

/** Raw Generations that have been worked on — they have a refining descendant or a saved workbench — most recently touched first. `state` narrows to しかかり (nothing delivered) or 完成 (some descendant delivered); `recipe` to one request recipe. */
export async function listWorkSources(
  db: D1Database,
  filters: { state?: WorkSourceState; recipe?: string; offset: number },
): Promise<{ items: WorkSource[]; hasMore: boolean; recipes: string[] }> {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (filters.state) {
    conditions.push('state = ?');
    binds.push(filters.state);
  }
  if (filters.recipe) {
    conditions.push('recipe = ?');
    binds.push(filters.recipe);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db
    .prepare(`${WORKED_ON_CTE} SELECT * FROM worked ${where} ORDER BY last_activity DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, WORK_SOURCES_PAGE_SIZE + 1, filters.offset)
    .all<WorkSource>();
  const rows = results ?? [];
  const recipeRows = await db
    .prepare(`${WORKED_ON_CTE} SELECT DISTINCT recipe FROM worked WHERE recipe IS NOT NULL ORDER BY recipe`)
    .all<{ recipe: string }>();
  return {
    items: rows.slice(0, WORK_SOURCES_PAGE_SIZE),
    hasMore: rows.length > WORK_SOURCES_PAGE_SIZE,
    recipes: (recipeRows.results ?? []).map((r) => r.recipe),
  };
}
