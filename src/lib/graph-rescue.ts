// original.png が purge / 再圧縮で消える前に、ComfyUI が書き込む `prompt` text chunk から
// 生成グラフを comfy_jobs.graph へ救出する。両ジョブ (original-purge.ts /
// original-recompress.ts) が同じ呼び出しを共有する。

import { nowIso } from './db';
import { extractPngTextChunk } from './image-meta';
import { extractRenderFacts } from './render-facts';
import type { Bindings, ComfyJobRow, GenerationRow } from '../types';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type GraphRescueSource = Pick<GenerationRow, 'id' | 'comfy_job_id' | 'r2_object_key'>;

/**
 * No-op when the job already has a graph. Otherwise reads `pngBytes` (or fetches the original
 * from R2 when omitted), extracts its `prompt` chunk, and writes `graph` + `render_facts_json`
 * (computed exactly as `PATCH /api/v1/jobs/:jobId` does) when it parses as a JSON object.
 * Invalid or absent metadata leaves `graph` NULL — never throws. Returns whether the job's graph
 * is non-NULL after the call (already was, or was just rescued), so a caller that is about to
 * destroy the only copy of the metadata can tell a genuine rescue failure from "nothing to rescue".
 */
export async function rescueGraphFromOriginal(
  env: Bindings,
  generation: GraphRescueSource,
  pngBytes?: Uint8Array,
): Promise<boolean> {
  const db = env.DB;
  const job = await db
    .prepare('SELECT id, graph FROM comfy_jobs WHERE id = ?')
    .bind(generation.comfy_job_id)
    .first<Pick<ComfyJobRow, 'id' | 'graph'>>();
  if (!job) return false;
  if (job.graph !== null) return true;

  let bytes = pngBytes;
  if (!bytes) {
    const object = await env.IMAGES.get(generation.r2_object_key);
    if (!object) return false;
    bytes = new Uint8Array(await object.arrayBuffer());
  }

  const text = extractPngTextChunk(bytes, 'prompt');
  if (!text) return false;

  let graph: unknown;
  try {
    graph = JSON.parse(text);
  } catch {
    return false;
  }
  if (!isJsonObject(graph)) return false;

  const facts = extractRenderFacts(graph);
  await db
    .prepare('UPDATE comfy_jobs SET graph = ?, render_facts_json = ?, updated_at = ? WHERE id = ? AND graph IS NULL')
    .bind(JSON.stringify(graph), JSON.stringify(facts), nowIso(), job.id)
    .run();
  return true;
}
