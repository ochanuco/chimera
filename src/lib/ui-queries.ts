// Read-only helpers for the Web GUI (src/routes/pages.ts, src/routes/images.ts).
// The Management API does not expose bookmark filtering for experiments, so the
// GUI queries D1 directly here rather than changing existing API routes.
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
