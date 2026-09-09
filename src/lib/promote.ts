// promote_to_pose (MCP) / POST /api/v1/presets/promote が呼ぶ。resolveDerivationSource
// (lib/requests.ts) と getPresetRow / resolvePreset (lib/presets.ts) の両方に依存するため、
// どちらのファイルにも属さずここに置く（presets.ts は requests.ts を import しない —
// requests.ts が presets.ts の pinPresets を使う片方向の依存と衝突させないため）。

import { getGenerationByIdOrShortId, nowIso } from './db';
import { resolveDerivationSource } from './requests';
import { conflict, notFound } from './errors';
import { getPresetRow, resolvePreset, serializeResolvedPreset } from './presets';
import { parseJsonObjectOrNull } from './overrides';
import { uuidv7 } from './uuidv7';
import type { PresetCreatedBy, PresetKind, PresetRow } from '../types';

export interface PromoteGenerationToPresetInput {
  generation_id: string;
  name: string;
  kind: PresetKind;
  base_version?: number;
  note?: string;
  idempotency_key: string;
  created_by: PresetCreatedBy;
}

/** The `{kind, name, version}` entry pinned for `kind` in a generate request's `generation.presets`, if any. */
function findPin(payloadJson: string, kind: PresetKind): { name: string; version: number } | undefined {
  let payload: { generation?: { presets?: unknown } };
  try {
    payload = JSON.parse(payloadJson) as { generation?: { presets?: unknown } };
  } catch {
    return undefined;
  }
  const presets = payload.generation?.presets;
  if (!Array.isArray(presets)) return undefined;
  for (const entry of presets) {
    if (
      entry &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>).kind === kind &&
      typeof (entry as Record<string, unknown>).name === 'string' &&
      typeof (entry as Record<string, unknown>).version === 'number'
    ) {
      return { name: (entry as Record<string, unknown>).name as string, version: (entry as Record<string, unknown>).version as number };
    }
  }
  return undefined;
}

export async function promoteGenerationToPreset(db: D1Database, input: PromoteGenerationToPresetInput) {
  const existing = await db.prepare('SELECT * FROM presets WHERE idempotency_key = ?').bind(input.idempotency_key).first<PresetRow>();
  if (existing) return serializeResolvedPreset(existing, await resolvePreset(db, existing));

  const generation = await getGenerationByIdOrShortId(db, input.generation_id);
  if (!generation) throw notFound('generation');
  if (generation.rating !== 'good') throw conflict('promote requires rating good');

  const { batch: sourceBatch } = await resolveDerivationSource(db, generation);
  const recipe = sourceBatch.recipe;
  if (!recipe) throw conflict('promote requires a recipe-mode batch');

  // その Batch を作った generate request が pin していた版 — 段階 B より前に作られた
  // Generation にはこの行自体が無いので、undefined のままにして base_version へ落ちる。
  const buildingRequest = await db
    .prepare(
      `SELECT payload_json FROM requests WHERE kind = 'generate' AND json_extract(result_json, '$.batch_id') = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(sourceBatch.id)
    .first<{ payload_json: string }>();
  const pin = buildingRequest ? findPin(buildingRequest.payload_json, input.kind) : undefined;

  const baseVersion = input.base_version ?? pin?.version;
  if (baseVersion === undefined) {
    throw conflict('no pinned preset for this generation; pass base_version');
  }

  const batchParameters = parseJsonObjectOrNull(sourceBatch.parameters_json) ?? {};
  const parameterName = batchParameters[input.kind];
  const baseName = pin?.name ?? (typeof parameterName === 'string' ? parameterName : undefined);
  if (baseName === undefined) {
    throw conflict('no pinned preset for this generation; pass base_version');
  }

  const baseRow = await getPresetRow(db, recipe, input.kind, baseName, baseVersion);
  if (!baseRow) {
    throw conflict(`preset base missing: ${recipe}/${input.kind}/${baseName}@${baseVersion}`);
  }

  // patches は Batch 行から取る。semantic.attributes.patches は生成後に書き換わりうる
  // 場所で正本になれない (docs/domain-model.md「Preset」不変条件)。全文上書きと
  // finalize / repair / masked_redraw の出力は patches を持たないのでここで弾かれる。
  let patches: unknown[] = [];
  if (sourceBatch.patches_json) {
    try {
      const parsed = JSON.parse(sourceBatch.patches_json) as unknown;
      if (Array.isArray(parsed)) patches = parsed;
    } catch {
      patches = [];
    }
  }
  if (patches.length === 0) {
    throw conflict('promote requires a batch with patches');
  }

  const bodyJson = JSON.stringify({
    base: { recipe, kind: input.kind, name: baseName, version: baseVersion },
    patches,
  });

  const id = uuidv7();
  const now = nowIso();

  try {
    // MAX(version) の読み取りと確定を1文にして、同じ (recipe, kind, name) への同時 promote
    // が同じ次番号を読んで UNIQUE (recipe, kind, name, version) に落ちるレースを避ける
    // (lib/experiments.ts の run_index 採番と同じ手)。
    await db
      .prepare(
        `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at, idempotency_key, base_fingerprint)
         SELECT ?, ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, 'active', 'promote', ?, ?, ?, ?, ?, ?
         FROM presets WHERE recipe = ? AND kind = ? AND name = ?`,
      )
      .bind(
        id,
        recipe,
        input.kind,
        input.name,
        bodyJson,
        generation.id,
        input.note ?? null,
        input.created_by,
        now,
        input.idempotency_key,
        sourceBatch.pose_fingerprint,
        recipe,
        input.kind,
        input.name,
      )
      .run();
  } catch (err) {
    // 同じ idempotency_key での同時 promote が UNIQUE (idempotency_key) に落ちるレース。
    // 先に確定した側を読み直す。version の衝突 (別 idempotency_key の同時 promote) はここでは
    // 拾えないので、そのまま呼び出し元に投げる。
    const raced = await db.prepare('SELECT * FROM presets WHERE idempotency_key = ?').bind(input.idempotency_key).first<PresetRow>();
    if (!raced) throw err;
    return serializeResolvedPreset(raced, await resolvePreset(db, raced));
  }

  const row = await db.prepare('SELECT * FROM presets WHERE id = ?').bind(id).first<PresetRow>();
  if (!row) throw new Error('promoted preset row missing after insert');

  return serializeResolvedPreset(row, await resolvePreset(db, row));
}
