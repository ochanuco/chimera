import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const graph = new Hono<AppEnv>();

interface BatchNodeRow {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  status: string;
  created_at: string;
  generation_count: number;
  thumbnail_generation_short_id: string | null;
}

interface ReferenceEdgeRow {
  source_batch_id: string;
  target_batch_id: string;
  source_generation_short_id: string;
  aspect: string | null;
}

interface RelationEdgeRow {
  source_batch_id: string;
  target_batch_id: string;
  relation_type: string | null;
  actor: string;
}

interface StoryEdgeRow {
  source_batch_id: string;
  target_batch_id: string;
  story_id: string;
  story_name: string;
  relation_label: string | null;
}

// GET /api/v1/graph — the whole-history provenance graph. Batches are nodes;
// the three Relation Separation kinds (docs/domain-model.md) become distinctly
// typed edges so the GUI can render them without conflating meaning.
graph.get('/', async (c) => {
  const db = c.env.DB;

  const [nodesResult, referencesResult, relationsResult, storyRelationsResult] = await Promise.all([
    db
      .prepare(
        `WITH counts AS (
           SELECT batch_id, COUNT(*) AS cnt FROM generations GROUP BY batch_id
         ),
         firsts AS (
           SELECT * FROM (
             SELECT g.batch_id, g.short_id,
               ROW_NUMBER() OVER (PARTITION BY g.batch_id ORDER BY g.created_at ASC, g.id ASC) AS rn
             FROM generations g
           ) WHERE rn = 1
         )
         SELECT b.id, b.short_id, b.raw_instruction, b.status, b.created_at,
           COALESCE(counts.cnt, 0) AS generation_count,
           firsts.short_id AS thumbnail_generation_short_id
         FROM batches b
         LEFT JOIN counts ON counts.batch_id = b.id
         LEFT JOIN firsts ON firsts.batch_id = b.id
         ORDER BY b.created_at ASC, b.id ASC`,
      )
      .all<BatchNodeRow>(),
    // Reference edges are provenance from a Generation to a Batch; rolled up to
    // the source Generation's own Batch so the graph stays batch-to-batch.
    db
      .prepare(
        `SELECT g.batch_id AS source_batch_id, br.target_batch_id AS target_batch_id,
           g.short_id AS source_generation_short_id, br.aspect AS aspect
         FROM batch_references br
         JOIN generations g ON g.id = br.source_generation_id
         ORDER BY br.created_at ASC`,
      )
      .all<ReferenceEdgeRow>(),
    db
      .prepare(
        `SELECT source_batch_id, target_batch_id, type AS relation_type, actor
         FROM batch_relations
         ORDER BY created_at ASC`,
      )
      .all<RelationEdgeRow>(),
    db
      .prepare(
        `SELECT sr.source_batch_id AS source_batch_id, sr.target_batch_id AS target_batch_id,
           sr.story_id AS story_id, s.name AS story_name, sr.label AS relation_label
         FROM story_relations sr
         JOIN stories s ON s.id = sr.story_id
         ORDER BY sr.created_at ASC`,
      )
      .all<StoryEdgeRow>(),
  ]);

  const nodes = (nodesResult.results ?? []).map((row) => ({
    id: row.id,
    short_id: row.short_id,
    raw_instruction: row.raw_instruction ? row.raw_instruction.slice(0, 60) : null,
    status: row.status,
    created_at: row.created_at,
    generation_count: row.generation_count,
    thumbnail_generation_short_id: row.thumbnail_generation_short_id,
  }));

  const referenceEdges = (referencesResult.results ?? [])
    .filter((row) => row.source_batch_id !== row.target_batch_id)
    .map((row) => ({
      type: 'reference' as const,
      source_batch_id: row.source_batch_id,
      target_batch_id: row.target_batch_id,
      label: `${row.aspect ?? 'reference'} (${row.source_generation_short_id})`,
      source_generation_short_id: row.source_generation_short_id,
      aspect: row.aspect,
    }));

  const relationEdges = (relationsResult.results ?? []).map((row) => ({
    type: 'relation' as const,
    source_batch_id: row.source_batch_id,
    target_batch_id: row.target_batch_id,
    label: `${row.relation_type ?? 'relation'} / ${row.actor}`,
    relation_type: row.relation_type,
    actor: row.actor,
  }));

  const storyEdges = (storyRelationsResult.results ?? []).map((row) => ({
    type: 'story' as const,
    source_batch_id: row.source_batch_id,
    target_batch_id: row.target_batch_id,
    label: `${row.story_name}: ${row.relation_label ?? '(no label)'}`,
    story_id: row.story_id,
  }));

  return c.json({
    nodes,
    edges: [...referenceEdges, ...relationEdges, ...storyEdges],
  });
});
