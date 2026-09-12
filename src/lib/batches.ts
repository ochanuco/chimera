// Batch 集約クエリ。REST (src/routes/batches.ts) と MCP tool `list_batch`
// (src/mcp.ts) の両方が使う共通部分だけをここに置く — REST の GET /:id は
// UI 向けにもっと多くのフィールド（siblings 等）を返すため、そちらは
// 引き続き route 側に持つ。

import { toBool } from './db';
import { canonicalGenerationUrl, generationImageUrl, serializeBatch } from './serialize';
import { renderFactsForJob } from './render-facts';
import { getExperimentRunFamily } from './experiments';
import { drawnPoseView } from './preset-references';
import type { BatchReferenceRow, BatchRelationRow, BatchRow, ComfyJobRow } from '../types';

interface BatchDigestGenerationRow {
  id: string;
  short_id: string;
  rating: string | null;
  bookmark: number;
  note: string | null;
  summary: string | null;
  semantic_json: string | null;
  seed: number | null;
  tag_names_json: string;
}

function parseSemanticAttributes(semanticJson: string | null): Record<string, unknown> | null {
  if (!semanticJson) return null;
  try {
    const parsed = JSON.parse(semanticJson) as { attributes?: unknown };
    return parsed.attributes && typeof parsed.attributes === 'object' ? (parsed.attributes as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** GET /api/v1/batches/{id} の subset — MCP `list_batch` が返す形。 */
export async function getBatchDigest(db: D1Database, org: string, batch: BatchRow) {
  const [jobsResult, generationsResult, referencesResult, outgoingResult, incomingResult, experimentRun, drawnPose] = await Promise.all([
    db.prepare('SELECT * FROM comfy_jobs WHERE batch_id = ? ORDER BY job_index ASC').bind(batch.id).all<ComfyJobRow>(),
    db
      .prepare(
        `SELECT g.id, g.short_id, g.rating, g.bookmark, g.note, g.summary, g.semantic_json,
           j.seed AS seed, json_group_array(t.name) AS tag_names_json
         FROM generations g
         LEFT JOIN comfy_jobs j ON j.id = g.comfy_job_id
         LEFT JOIN generation_tags gt ON gt.generation_id = g.id
         LEFT JOIN tags t ON t.id = gt.tag_id
         WHERE g.batch_id = ?
         GROUP BY g.id
         ORDER BY g.created_at ASC`,
      )
      .bind(batch.id)
      .all<BatchDigestGenerationRow>(),
    db
      .prepare('SELECT * FROM batch_references WHERE target_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchReferenceRow>(),
    db
      .prepare('SELECT * FROM batch_relations WHERE source_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchRelationRow>(),
    db
      .prepare('SELECT * FROM batch_relations WHERE target_batch_id = ? ORDER BY created_at ASC')
      .bind(batch.id)
      .all<BatchRelationRow>(),
    getExperimentRunFamily(db, batch.id),
    drawnPoseView(db, batch),
  ]);

  const jobRows = jobsResult.results ?? [];
  const renderFactsByJobId = new Map(
    await Promise.all(jobRows.map(async (j) => [j.id, await renderFactsForJob(db, j)] as const)),
  );

  return {
    batch: { ...serializeBatch(batch), drawn_pose: drawnPose },
    jobs: jobRows.map((j) => ({
      id: j.id,
      comfy_prompt_id: j.comfy_prompt_id,
      seed: j.seed,
      index: j.job_index,
      status: j.status,
      render_facts: renderFactsByJobId.get(j.id) ?? null,
    })),
    generations: (generationsResult.results ?? []).map((g) => {
      const tagArray = g.tag_names_json ? (JSON.parse(g.tag_names_json) as unknown[]) : [];
      const tags = Array.isArray(tagArray) ? tagArray.filter((t): t is string => typeof t === 'string') : [];
      return {
        id: g.id,
        short_id: g.short_id,
        canonical_url: canonicalGenerationUrl(org, g.short_id),
        image_url: generationImageUrl(org, g.short_id),
        rating: g.rating,
        bookmark: toBool(g.bookmark),
        note: g.note,
        tags,
        semantic_summary: g.summary,
        semantic_attributes: parseSemanticAttributes(g.semantic_json),
        seed: g.seed,
      };
    }),
    references: (referencesResult.results ?? []).map((r) => ({
      id: r.id,
      source_generation_id: r.source_generation_id,
      purpose: r.purpose,
      aspect: r.aspect,
      instruction: r.instruction,
      created_at: r.created_at,
    })),
    relations: {
      outgoing: (outgoingResult.results ?? []).map((r) => ({
        id: r.id,
        target_batch_id: r.target_batch_id,
        type: r.type,
        actor: r.actor,
        reason: r.reason,
        raw_instruction: r.raw_instruction,
        created_at: r.created_at,
      })),
      incoming: (incomingResult.results ?? []).map((r) => ({
        id: r.id,
        source_batch_id: r.source_batch_id,
        type: r.type,
        actor: r.actor,
        reason: r.reason,
        raw_instruction: r.raw_instruction,
        created_at: r.created_at,
      })),
    },
    experiment_run: experimentRun,
  };
}
