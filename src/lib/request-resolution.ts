// worker が Request に直接報告する解決済みの値 (resolution) と、その Request から作る Job。

import { getGenerationByIdOrShortId, nowIso } from './db';
import { conflict, notFound, badRequest } from './errors';
import { stableStringify } from './json-canonical';
import { uuidv7 } from './uuidv7';
import { createUniqueRequestShortId } from './shortid';
import type { ComfyJobRow, RequestRow } from '../types';
import type { PutResolutionInput } from '../schemas/requests';

export type ResolutionInput = Omit<PutResolutionInput, 'parameters' | 'worker_id'> & { parameters: Record<string, unknown> };

export interface ResolvedReference {
  generationId: string;
  purpose: string | null;
  aspect: string | null;
  instruction: string | null;
}

export interface NormalizedResolution {
  recipe: string | null;
  raw_instruction: string | null;
  parameters_json: string;
  patches_json: string | null;
  pose_fingerprint: string | null;
  preset_versions_json: string | null;
  git_commit: string | null;
  git_dirty: number;
  references: ResolvedReference[];
}

/** rebuild は Job の source_generation_id で表すので素材参照には持たない。 */
export async function normalizeResolution(
  db: D1Database,
  input: ResolutionInput,
  existingPresetVersionsJson: string | null,
): Promise<NormalizedResolution> {
  const references: ResolvedReference[] = [];
  for (const ref of input.references ?? []) {
    if (ref.purpose === 'rebuild') continue;
    const key = (ref.source_generation_id ?? ref.generation_id)!;
    const generation = await getGenerationByIdOrShortId(db, key);
    if (!generation) throw notFound(`referenced generation '${key}'`);
    references.push({
      generationId: generation.id,
      purpose: ref.purpose ?? null,
      aspect: ref.aspect ?? null,
      instruction: ref.instruction ?? null,
    });
  }
  return {
    recipe: input.recipe ?? null,
    raw_instruction: input.raw_instruction ?? null,
    parameters_json: JSON.stringify(input.parameters),
    patches_json: input.patches ? JSON.stringify(input.patches) : null,
    pose_fingerprint: input.pose_fingerprint ?? null,
    // 省略は「触らない」。request 完了時に payload の pin から書かれる値を消さない。
    preset_versions_json: input.preset_versions ? JSON.stringify(input.preset_versions) : existingPresetVersionsJson,
    git_commit: input.git_commit ?? null,
    git_dirty: input.git_dirty ? 1 : 0,
    references,
  };
}

function canonicalJson(json: string | null): string {
  return json === null ? 'null' : stableStringify(JSON.parse(json));
}

function referenceKeys(refs: ResolvedReference[]): string[] {
  return refs.map((r) => stableStringify([r.generationId, r.purpose, r.aspect, r.instruction])).sort();
}

export async function storedReferences(db: D1Database, requestId: string): Promise<ResolvedReference[]> {
  const { results } = await db
    .prepare('SELECT source_generation_id, purpose, aspect, instruction FROM request_references WHERE target_request_id = ?')
    .bind(requestId)
    .all<{ source_generation_id: string; purpose: string | null; aspect: string | null; instruction: string | null }>();
  return (results ?? []).map((r) => ({
    generationId: r.source_generation_id,
    purpose: r.purpose,
    aspect: r.aspect,
    instruction: r.instruction,
  }));
}

/** resolution が一度でも報告されたか。parameters は必須なので、報告後は必ず NULL でなくなる。 */
export function isResolved(row: RequestRow): boolean {
  return row.parameters_json !== null;
}

export async function sameResolution(db: D1Database, row: RequestRow, next: NormalizedResolution): Promise<boolean> {
  if (!isResolved(row)) return false;
  return (
    row.recipe === next.recipe &&
    row.raw_instruction === next.raw_instruction &&
    row.pose_fingerprint === next.pose_fingerprint &&
    row.git_commit === next.git_commit &&
    (row.git_dirty ?? 0) === next.git_dirty &&
    canonicalJson(row.parameters_json) === canonicalJson(next.parameters_json) &&
    canonicalJson(row.patches_json) === canonicalJson(next.patches_json) &&
    canonicalJson(row.preset_versions_json) === canonicalJson(next.preset_versions_json) &&
    stableStringify(referenceKeys(await storedReferences(db, row.id))) === stableStringify(referenceKeys(next.references))
  );
}

export async function requestHasJobs(db: D1Database, requestId: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM comfy_jobs WHERE request_id = ? LIMIT 1').bind(requestId).first()) !== null;
}

/** resolution の書き込み。Request の列と request_references を同じ db.batch に積む。`shortId` は Request に発行済みの値。 */
export function resolutionStatements(
  db: D1Database,
  args: { requestId: string; shortId: string; resolution: NormalizedResolution },
): D1PreparedStatement[] {
  const { requestId, shortId, resolution: r } = args;
  const now = nowIso();
  return [
    db
      .prepare(
        `UPDATE requests SET short_id = ?, recipe = ?, raw_instruction = ?, parameters_json = ?, patches_json = ?,
           pose_fingerprint = ?, preset_versions_json = ?, git_commit = ?, git_dirty = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(shortId, r.recipe, r.raw_instruction, r.parameters_json, r.patches_json, r.pose_fingerprint, r.preset_versions_json, r.git_commit, r.git_dirty, now, requestId),
    db.prepare('DELETE FROM request_references WHERE target_request_id = ?').bind(requestId),
    ...r.references.map((ref) =>
      db
        .prepare(
          'INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(uuidv7(), ref.generationId, requestId, ref.purpose, ref.aspect, ref.instruction, now),
    ),
  ];
}

// worker-protocol.md「再送レスポンスに含めるもの」: jobs[] は seed/status/comfy_prompt_id + ingest 済み generations。
// graph は含めない (recipe と seed から再構築できる)。
export async function buildRequestJobs(db: D1Database, requestId: string) {
  const [jobsResult, generationsResult] = await Promise.all([
    db.prepare('SELECT * FROM comfy_jobs WHERE request_id = ? ORDER BY job_index ASC').bind(requestId).all<ComfyJobRow>(),
    db
      .prepare('SELECT id, comfy_job_id, comfy_output_index FROM generations WHERE request_id = ? ORDER BY created_at ASC, id ASC')
      .bind(requestId)
      .all<{ id: string; comfy_job_id: string; comfy_output_index: number | null }>(),
  ]);

  const byJob = new Map<string, { id: string; comfy_output_index: number | null }[]>();
  for (const g of generationsResult.results ?? []) {
    const list = byJob.get(g.comfy_job_id) ?? [];
    list.push({ id: g.id, comfy_output_index: g.comfy_output_index });
    byJob.set(g.comfy_job_id, list);
  }

  return (jobsResult.results ?? []).map((j) => ({
    id: j.id,
    index: j.job_index,
    seed: j.seed,
    status: j.status,
    comfy_prompt_id: j.comfy_prompt_id,
    generations: byJob.get(j.id) ?? [],
  }));
}

/** 仕上げ系 kind は元になる Generation を Job ごとに指す。generate / import は持たない。 */
export function requiresSourceGeneration(kind: RequestRow['kind']): boolean {
  return kind === 'finalize' || kind === 'redraw' || kind === 'repair' || kind === 'masked_redraw' || kind === 'deliver' || kind === 'dof';
}

export interface CreateRequestJobInput {
  idempotency_key: string;
  seed: number;
  index: number;
  source_generation_id?: string | null;
}

export async function createRequestJob(
  db: D1Database,
  row: RequestRow,
  body: CreateRequestJobInput,
): Promise<{ status: 200 | 201; job: Record<string, unknown> }> {
  const existing = await db.prepare('SELECT * FROM comfy_jobs WHERE idempotency_key = ?').bind(body.idempotency_key).first<ComfyJobRow>();
  if (existing) return { status: 200, job: await replayJob(db, row, existing) };

  if (row.status === 'cancelled') throw conflict('request is cancelled');
  if (!isResolved(row)) throw conflict('resolution has not been reported for this request');

  let sourceGenerationId: string | null = null;
  if (requiresSourceGeneration(row.kind)) {
    if (!body.source_generation_id) throw badRequest(`source_generation_id is required for kind ${row.kind}`);
    const source = await getGenerationByIdOrShortId(db, body.source_generation_id);
    if (!source) throw notFound(`source generation '${body.source_generation_id}'`);
    sourceGenerationId = source.id;
  } else if (body.source_generation_id) {
    throw badRequest(`source_generation_id is not accepted for kind ${row.kind}`);
  }

  const id = uuidv7();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO comfy_jobs (id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, source_generation_id)
       VALUES (?, ?, NULL, ?, ?, 'created', ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(id, row.id, body.seed, body.index, body.idempotency_key, now, now, sourceGenerationId)
    .run();

  const created = await db.prepare('SELECT * FROM comfy_jobs WHERE idempotency_key = ?').bind(body.idempotency_key).first<ComfyJobRow>();
  if (created && created.id !== id) return { status: 200, job: await replayJob(db, row, created) };
  return {
    status: 201,
    job: {
      id,
      request_id: row.id,
      seed: body.seed,
      index: body.index,
      status: 'created',
      comfy_prompt_id: null,
      source_generation_id: sourceGenerationId,
      generations: [],
    },
  };
}

async function replayJob(db: D1Database, row: RequestRow, job: ComfyJobRow) {
  if (job.request_id !== row.id) throw conflict('idempotency_key belongs to a job of another request');
  const { results } = await db
    .prepare('SELECT id, comfy_output_index FROM generations WHERE comfy_job_id = ? ORDER BY created_at ASC, id ASC')
    .bind(job.id)
    .all<{ id: string; comfy_output_index: number | null }>();
  return {
    id: job.id,
    request_id: job.request_id,
    seed: job.seed,
    index: job.job_index,
    status: job.status,
    comfy_prompt_id: job.comfy_prompt_id,
    source_generation_id: job.source_generation_id,
    generations: (results ?? []).map((g) => ({ id: g.id, comfy_output_index: g.comfy_output_index })),
  };
}

/**
 * PUT /requests/{id}/resolution の本体。Job が 1 件でもあれば値は変えられない (同じ値の再送だけ通る)。
 * 戻り値は書き込みが起きたか。
 */
export async function putResolution(db: D1Database, row: RequestRow, input: ResolutionInput, workerId?: string): Promise<boolean> {
  if (row.status === 'cancelled') throw conflict('request is cancelled');
  if (workerId && row.status === 'running' && row.worker_id !== workerId) throw conflict('worker_id does not match the claim');

  const resolution = await normalizeResolution(db, input, row.preset_versions_json);
  if (await sameResolution(db, row, resolution)) return false;
  if (isResolved(row) && (await requestHasJobs(db, row.id))) {
    throw conflict('resolution differs from the one already reported and jobs exist for this request');
  }

  const shortId = row.short_id ?? (await createUniqueRequestShortId(db));
  await db.batch(resolutionStatements(db, { requestId: row.id, shortId, resolution }));
  return true;
}
