// pose の基準 render の pin (docs/domain-model.md「Preset」基準 render の pin)。
// promoteGenerationToPreset (lib/promote.ts) と同じ理由でここに置く: resolveDerivationSource
// (lib/requests.ts) と getPresetRow (lib/presets.ts) の両方に依存するため、どちらのファイル
// にも属さない — presets.ts は requests.ts を import しない片方向依存を保つため。

import { getGenerationByIdOrShortId, nowIso } from './db';
import { resolveDerivationSource } from './requests';
import { conflict, notFound } from './errors';
import { getPresetRow } from './presets';
import { parseJsonObjectOrNull } from './overrides';
import { uuidv7 } from './uuidv7';
import type { PresetCreatedBy, PresetKind, PresetReferenceRow } from '../types';

/** Parses a stored JSON array column (`patches_json` / `preset_versions_json`); NULL や非配列は `[]`。 */
function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface PresetReferenceView {
  generation_id: string;
  short_id: string;
  seed: number;
}

/** The current (not superseded) pin for one (recipe, kind, name), or null when none has ever been set. */
export async function getCurrentReference(
  db: D1Database,
  recipe: string,
  kind: PresetKind,
  name: string,
): Promise<PresetReferenceRow | null> {
  return db
    .prepare('SELECT * FROM preset_references WHERE recipe = ? AND kind = ? AND name = ? AND superseded_at IS NULL')
    .bind(recipe, kind, name)
    .first<PresetReferenceRow>();
}

/** Joins `generations` for the pinned Generation's short_id. null in, null out. */
export async function referenceView(db: D1Database, row: PresetReferenceRow | null): Promise<PresetReferenceView | null> {
  if (!row) return null;
  const generation = await db
    .prepare('SELECT short_id FROM generations WHERE id = ?')
    .bind(row.generation_id)
    .first<{ short_id: string }>();
  if (!generation) return null;
  return { generation_id: row.generation_id, short_id: generation.short_id, seed: row.seed };
}

/** Every current pin matching `filters`, keyed by `[recipe, kind, name].join(' ')` — one query for attachReferences to fan out over a list. */
export async function listCurrentReferences(
  db: D1Database,
  filters: { recipe?: string; kind?: PresetKind } = {},
): Promise<Map<string, PresetReferenceView>> {
  const conditions = ['pr.superseded_at IS NULL'];
  const params: unknown[] = [];
  if (filters.recipe) {
    conditions.push('pr.recipe = ?');
    params.push(filters.recipe);
  }
  if (filters.kind) {
    conditions.push('pr.kind = ?');
    params.push(filters.kind);
  }

  const { results } = await db
    .prepare(
      `SELECT pr.recipe, pr.kind, pr.name, pr.generation_id, pr.seed, g.short_id
       FROM preset_references pr JOIN generations g ON g.id = pr.generation_id
       WHERE ${conditions.join(' AND ')}`,
    )
    .bind(...params)
    .all<{ recipe: string; kind: string; name: string; generation_id: string; seed: number; short_id: string }>();

  const map = new Map<string, PresetReferenceView>();
  for (const r of results ?? []) {
    map.set([r.recipe, r.kind, r.name].join(' '), { generation_id: r.generation_id, short_id: r.short_id, seed: r.seed });
  }
  return map;
}

/** Decorates `items` with their current pin (null when unpinned) via one shared query. */
export async function attachReferences<T extends { recipe: string; kind: PresetKind; name: string }>(
  db: D1Database,
  items: T[],
  filters: { recipe?: string; kind?: PresetKind } = {},
): Promise<(T & { reference: PresetReferenceView | null })[]> {
  const map = await listCurrentReferences(db, filters);
  return items.map((item) => ({ ...item, reference: map.get([item.recipe, item.kind, item.name].join(' ')) ?? null }));
}

export interface SetPoseReferenceInput {
  recipe: string;
  pose: string;
  generation_id: string;
  idempotency_key: string;
  created_by: PresetCreatedBy;
}

export interface SetPoseReferenceResult {
  created: boolean;
  recipe: string;
  kind: 'pose';
  name: string;
  reference: PresetReferenceView;
  source: { generation_id: string; short_id: string };
  superseded: PresetReferenceView | null;
}

async function toResult(
  db: D1Database,
  row: PresetReferenceRow,
  created: boolean,
  superseded: PresetReferenceView | null,
): Promise<SetPoseReferenceResult> {
  const reference = await referenceView(db, row);
  if (!reference) throw new Error('preset reference row missing its generation');
  const source = await db
    .prepare('SELECT short_id FROM generations WHERE id = ?')
    .bind(row.source_generation_id)
    .first<{ short_id: string }>();
  if (!source) throw new Error('preset reference row missing its source generation');
  return {
    created,
    recipe: row.recipe,
    kind: 'pose',
    name: row.name,
    reference,
    source: { generation_id: row.source_generation_id, short_id: source.short_id },
    superseded,
  };
}

/**
 * Pins `generation_id` as the baseline render for `recipe`/`pose`. Rules, in order:
 * 1. idempotency replay: same (recipe, pose, resolved generation) returns the existing row;
 *    a different one 409s.
 * 2. the pose must already exist as a Preset.
 * 3. generation_id must resolve and carry rating=good.
 * 4. finalize/repair outputs resolve to their raw Generation (resolveDerivationSource, same as
 *    derive_request).
 * 5. the resolved Batch must be a *plain render* of recipe/pose — same recipe, drew this pose, no
 *    patches, and the queued generate request (when one exists) did not override the prompt.
 *    Every failing rule is collected into one 409 message.
 * 6. the seed comes from the resolved Generation's comfy_job.
 * Re-setting supersedes the previous current row rather than overwriting it — the history is kept.
 */
export async function setPoseReference(db: D1Database, input: SetPoseReferenceInput): Promise<SetPoseReferenceResult> {
  const existing = await db
    .prepare('SELECT * FROM preset_references WHERE idempotency_key = ?')
    .bind(input.idempotency_key)
    .first<PresetReferenceRow>();

  const generation = await getGenerationByIdOrShortId(db, input.generation_id);
  if (!generation) throw notFound('generation');

  if (existing) {
    const sameInput =
      existing.recipe === input.recipe &&
      existing.kind === 'pose' &&
      existing.name === input.pose &&
      existing.generation_id === generation.id;
    if (!sameInput) throw conflict('idempotency_key already used for a different reference');
    return toResult(db, existing, false, null);
  }

  const presetRow = await getPresetRow(db, input.recipe, 'pose', input.pose);
  if (!presetRow) throw notFound(`preset '${input.recipe}/pose/${input.pose}'`);

  if (generation.rating !== 'good') throw conflict('set_pose_reference requires rating good');

  const { generation: source, batch } = await resolveDerivationSource(db, generation);

  const reasons: string[] = [];
  if (batch.recipe !== input.recipe) reasons.push(`recipe is '${batch.recipe ?? 'none (graph-mode)'}'`);

  const parameters = parseJsonObjectOrNull(batch.parameters_json) ?? {};
  const presetVersions = parseJsonArray(batch.preset_versions_json) as { kind?: unknown; name?: unknown }[];
  const posePin = presetVersions.find((p) => p && typeof p === 'object' && p.kind === 'pose');
  const drawnPose = typeof posePin?.name === 'string' ? posePin.name : typeof parameters.pose === 'string' ? parameters.pose : undefined;
  if (drawnPose !== input.pose) reasons.push(`pose is '${drawnPose ?? 'unset'}'`);

  const patches = parseJsonArray(batch.patches_json);
  if (patches.length > 0) reasons.push(`batch carries ${patches.length} patches`);

  const buildingRequest = await db
    .prepare(
      `SELECT payload_json FROM requests WHERE kind = 'generate' AND json_extract(result_json, '$.batch_id') = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(batch.id)
    .first<{ payload_json: string }>();
  if (buildingRequest) {
    let payload: { generation?: { prompt?: unknown; negative_prompt?: unknown } } = {};
    try {
      payload = JSON.parse(buildingRequest.payload_json) as typeof payload;
    } catch {
      payload = {};
    }
    const generationField = payload.generation;
    if (generationField && (typeof generationField.prompt === 'string' || typeof generationField.negative_prompt === 'string')) {
      reasons.push('request overrides the prompt');
    }
  }

  if (reasons.length > 0) {
    throw conflict(`resolved batch '${batch.short_id}' is not a plain render of ${input.recipe}/${input.pose}: ${reasons.join('; ')}`);
  }

  const job = await db.prepare('SELECT seed FROM comfy_jobs WHERE id = ?').bind(source.comfy_job_id).first<{ seed: number | null }>();
  if (!job || job.seed === null) throw conflict('resolved generation has no seed');
  const seed = job.seed;

  const previous = await getCurrentReference(db, input.recipe, 'pose', input.pose);
  const superseded = await referenceView(db, previous);

  const id = uuidv7();
  const now = nowIso();

  try {
    await db.batch([
      db
        .prepare(`UPDATE preset_references SET superseded_at = ? WHERE recipe = ? AND kind = 'pose' AND name = ? AND superseded_at IS NULL`)
        .bind(now, input.recipe, input.pose),
      db
        .prepare(
          `INSERT INTO preset_references (id, recipe, kind, name, generation_id, source_generation_id, seed, idempotency_key, created_by, created_at, superseded_at)
           VALUES (?, ?, 'pose', ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(id, input.recipe, input.pose, generation.id, source.id, seed, input.idempotency_key, input.created_by, now),
    ]);
  } catch (err) {
    // 同じ idempotency_key での同時 set_pose_reference が UNIQUE (idempotency_key) に落ちるレース
    // (lib/promote.ts と同じ手)。先に確定した側を読み直す。
    const raced = await db.prepare('SELECT * FROM preset_references WHERE idempotency_key = ?').bind(input.idempotency_key).first<PresetReferenceRow>();
    if (!raced) throw err;
    return toResult(db, raced, false, null);
  }

  const row = await db.prepare('SELECT * FROM preset_references WHERE id = ?').bind(id).first<PresetReferenceRow>();
  if (!row) throw new Error('preset reference row missing after insert');
  return toResult(db, row, true, superseded);
}
