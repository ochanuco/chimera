// Read-only helpers for the Web GUI (src/routes/pages.ts, src/routes/images.ts).
// The Management API does not expose bookmark filtering for stories/experiments,
// so the GUI queries D1 directly here rather than changing existing API routes.
import type { ExperimentRow, StoryRow } from '../types';

export interface BookmarkedStory {
  id: string;
  name: string;
  batch_count: number;
}

export async function listBookmarkedStories(db: D1Database): Promise<BookmarkedStory[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, (
         SELECT COUNT(*) FROM (
           SELECT source_batch_id AS batch_id FROM story_relations WHERE story_id = s.id
           UNION
           SELECT target_batch_id AS batch_id FROM story_relations WHERE story_id = s.id
         )
       ) AS batch_count
       FROM stories s
       WHERE s.bookmark = 1
       ORDER BY s.created_at DESC`,
    )
    .all<StoryRow & { batch_count: number }>();
  return (results ?? []).map((r) => ({ id: r.id, name: r.name, batch_count: r.batch_count }));
}

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
