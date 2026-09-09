// Preset のクエリ。REST (src/routes/presets.ts) と MCP tools `list_presets` /
// `get_preset` (src/mcp.ts) の両方がここを呼ぶ。読み取りと catalog からの取り込み
// (段階 A) に加え、版の pin (段階 B, docs/worker-protocol.md「preset の pin」) もここに
// 置く。promote は resolveDerivationSource (lib/requests.ts) を要るため、この
// ファイルから requests.ts への依存を作らないよう lib/promote.ts に分けている。

import { nowIso } from './db';
import { getCatalog } from './catalogs';
import { badRequest, conflict, notFound } from './errors';
import { presetBodySchema, type PresetBody } from '../schemas/presets';
import { uuidv7 } from './uuidv7';
import type { JsonObject } from './overrides';
import type { PresetKind, PresetRow, PresetSource, PresetStatus } from '../types';

// src/lib/catalogs.ts の extractNames と同じ判定。catalogs.ts は段階 C で消えるので
// 共有せず、preset 側が自分の抽出を持つ。
function extractEntryName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string') {
    return (entry as Record<string, unknown>).name as string;
  }
  return null;
}

export interface PresetSummary {
  id: string;
  recipe: string;
  kind: PresetKind;
  name: string;
  version: number;
  status: PresetStatus;
  source: PresetSource;
  source_generation_id: string | null;
  base_fingerprint: string | null;
  note: string | null;
  created_at: string;
}

function summarizePreset(row: PresetRow): PresetSummary {
  return {
    id: row.id,
    recipe: row.recipe,
    kind: row.kind,
    name: row.name,
    version: row.version,
    status: row.status,
    source: row.source,
    source_generation_id: row.source_generation_id,
    base_fingerprint: row.base_fingerprint,
    note: row.note,
    created_at: row.created_at,
  };
}

export interface PresetImportResult {
  imported: PresetSummary[];
  skipped: { recipe: string; kind: PresetKind; name: string }[];
}

/**
 * Idempotent: a name already present at any version (regardless of status) is skipped, so
 * calling this repeatedly for the same recipe_ref converges rather than accumulating
 * duplicate version-1 rows (docs/worker-protocol.md「preset の移行」段階 A).
 */
export async function importFromCatalog(db: D1Database, recipeRef: string): Promise<PresetImportResult> {
  const found = await getCatalog(db, recipeRef);
  if (!found) throw notFound('recipe catalog');

  const imported: PresetSummary[] = [];
  const skipped: { recipe: string; kind: PresetKind; name: string }[] = [];
  const now = nowIso();

  // カタログ 1件あたり数十〜百件のエントリを回すので、存在確認はエントリごとに引かず
  // 一度で済ませる。preset は物理削除しないため、この一覧が途中で古くなることもない。
  const { results: existingRows } = await db
    .prepare('SELECT DISTINCT recipe, kind, name FROM presets')
    .all<{ recipe: string; kind: string; name: string }>();
  const seen = new Set((existingRows ?? []).map((r) => [r.recipe, r.kind, r.name].join('\u0000')));

  const inserts: D1PreparedStatement[] = [];
  const insertStatement = db.prepare(
    `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at, base_fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // costume / expression は import しない。catalog がそれらに publish できるのは名前の
  // 配列だけで、参照にしても行が増えるだけで何も足さない (docs/domain-model.md「Preset」
  // body の形)。
  const kind: PresetKind = 'pose';
  for (const recipe of found.doc.recipes) {
    const r = recipe as Record<string, unknown>;
    if (typeof r.name !== 'string') continue;
    const recipeName = r.name;

    const entries = r.poses;
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      const name = extractEntryName(entry);
      if (name === null) continue;

      const key = [recipeName, kind, name].join('\u0000');
      if (seen.has(key)) {
        skipped.push({ recipe: recipeName, kind, name });
        continue;
      }
      seen.add(key);

      const row: PresetRow = {
        id: uuidv7(),
        recipe: recipeName,
        kind,
        name,
        version: 1,
        body_json: JSON.stringify({ recipe_pose: name }),
        status: 'active',
        source: 'import',
        source_generation_id: null,
        note: null,
        created_by: 'system',
        created_at: now,
        idempotency_key: null,
        base_fingerprint: null,
      };
      inserts.push(
        insertStatement.bind(
          row.id,
          row.recipe,
          row.kind,
          row.name,
          row.version,
          row.body_json,
          row.status,
          row.source,
          row.source_generation_id,
          row.note,
          row.created_by,
          row.created_at,
          row.base_fingerprint,
        ),
      );
      imported.push(summarizePreset(row));
    }
  }

  if (inserts.length > 0) await db.batch(inserts);

  return { imported, skipped };
}

const PIN_KINDS: PresetKind[] = ['pose', 'costume', 'expression'];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Explicit `generation.presets` bypasses resolution from `parameters`, but the two must still
 * agree per kind: worker decides `parameters.{kind}` vs. the pin's `name` by fiat, not chimera
 * (docs/worker-protocol.md「preset の pin」). A kind missing from `parameters` is unchecked —
 * omission is allowed.
 */
/**
 * The pins the caller supplied, or null when `generation.presets` is absent or not an array.
 * A malformed entry is rejected rather than skipped: dropping it would silently re-resolve that
 * kind from `parameters` and pin the latest active version instead of the one the caller named.
 */
function existingPins(generation: JsonObject): { kind: PresetKind; name: string; version: number }[] | null {
  const presets = generation.presets;
  if (!Array.isArray(presets)) return null;
  const pins: { kind: PresetKind; name: string; version: number }[] = [];
  for (const entry of presets) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw badRequest('generation.presets entry must be an object');
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.kind !== 'string' || typeof e.name !== 'string' || typeof e.version !== 'number') {
      throw badRequest('generation.presets entry requires kind, name and a numeric version');
    }
    if (!(PIN_KINDS as readonly string[]).includes(e.kind)) {
      throw badRequest(`generation.presets has an unknown kind: ${e.kind}`);
    }
    pins.push({ kind: e.kind as PresetKind, name: e.name, version: e.version });
  }
  return pins;
}

function assertPinsMatchParameters(generation: JsonObject): void {
  const presets = generation.presets;
  if (!Array.isArray(presets)) return;
  const parameters = isJsonObject(generation.parameters) ? generation.parameters : {};

  for (const entry of presets) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = (entry as Record<string, unknown>).kind;
    const name = (entry as Record<string, unknown>).name;
    if (typeof kind !== 'string' || typeof name !== 'string') continue;

    const paramValue = parameters[kind];
    if (typeof paramValue !== 'string') continue;
    if (paramValue !== name) throw badRequest(`parameters.${kind} does not match the pinned preset`);
  }
}

/**
 * Pure transform: resolves `generation.parameters.{pose,costume,expression}` to pinned
 * `{kind, name, version}` entries under `generation.presets` (docs/worker-protocol.md
 * 「preset の pin」). Never mutates `payload` — returns it unchanged (by reference) when
 * there is nothing to pin, so callers hashing the result don't see spurious differences.
 */
export async function pinPresets(db: D1Database, payload: JsonObject): Promise<JsonObject> {
  const generation = payload.generation;
  if (!isJsonObject(generation)) return payload;
  if (generation.graph || typeof generation.recipe !== 'string') return payload;
  // 明示された pin は版ごと尊重し、pin されていない kind だけ parameters から解決する。
  // derive_request が「一部の kind だけ pin を引き継ぎ、残りは呼び出し側の指名」という
  // payload を組むため、明示があったら丸ごと手を引くと残りが pin されないまま通る。
  const given = existingPins(generation);
  if (given) assertPinsMatchParameters(generation);

  const recipe = generation.recipe;
  const hasAnyPreset = await db.prepare('SELECT 1 FROM presets WHERE recipe = ? LIMIT 1').bind(recipe).first();
  if (!hasAnyPreset) return payload;

  const parameters = isJsonObject(generation.parameters) ? generation.parameters : {};
  const pinnedKinds = new Set((given ?? []).map((pin) => pin.kind));
  const pins = [...(given ?? [])];
  for (const kind of PIN_KINDS) {
    if (pinnedKinds.has(kind)) continue;
    const name = parameters[kind];
    if (typeof name !== 'string' || name === '') continue;
    const row = await getPresetRow(db, recipe, kind, name);
    if (!row) throw badRequest(`preset not found: ${recipe}/${kind}/${name}`);
    pins.push({ kind, name, version: row.version });
  }

  if (pins.length === (given?.length ?? 0)) return payload;

  return { ...payload, generation: { ...generation, presets: pins } };
}

export interface ListPresetsFilters {
  recipe?: string;
  kind?: PresetKind;
  includeDeprecated?: boolean;
}

/**
 * One row per (recipe, kind, name), the highest version among the rows the status filter
 * admits — so with the default active-only filter, a name whose newest version has been
 * deprecated still surfaces at its latest active version rather than disappearing.
 */
export async function listPresets(db: D1Database, filters: ListPresetsFilters = {}): Promise<PresetSummary[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.recipe) {
    conditions.push('recipe = ?');
    params.push(filters.recipe);
  }
  if (filters.kind) {
    conditions.push('kind = ?');
    params.push(filters.kind);
  }
  if (!filters.includeDeprecated) {
    conditions.push("status = 'active'");
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY recipe, kind, name ORDER BY version DESC) AS rn
         FROM presets
         ${where}
       ) WHERE rn = 1
       ORDER BY recipe, kind, name`,
    )
    .bind(...params)
    .all<PresetRow>();

  return (results ?? []).map(summarizePreset);
}

/** Every version of one (recipe, kind, name), newest first; [] when the name doesn't exist. */
export async function listPresetVersions(
  db: D1Database,
  recipe: string,
  kind: PresetKind,
  name: string,
  includeDeprecated = false,
): Promise<PresetSummary[]> {
  const conditions = ['recipe = ?', 'kind = ?', 'name = ?'];
  const params: unknown[] = [recipe, kind, name];
  if (!includeDeprecated) conditions.push("status = 'active'");

  const { results } = await db
    .prepare(`SELECT * FROM presets WHERE ${conditions.join(' AND ')} ORDER BY version DESC`)
    .bind(...params)
    .all<PresetRow>();

  return (results ?? []).map(summarizePreset);
}

/** version omitted resolves to the latest active version; an explicit version ignores status, since a past request may have pinned a version since deprecated. */
export async function getPresetRow(
  db: D1Database,
  recipe: string,
  kind: PresetKind,
  name: string,
  version?: number,
): Promise<PresetRow | null> {
  if (version !== undefined) {
    return db
      .prepare('SELECT * FROM presets WHERE recipe = ? AND kind = ? AND name = ? AND version = ?')
      .bind(recipe, kind, name, version)
      .first<PresetRow>();
  }
  return db
    .prepare(
      `SELECT * FROM presets WHERE recipe = ? AND kind = ? AND name = ? AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
    )
    .bind(recipe, kind, name)
    .first<PresetRow>();
}

const MAX_RESOLVE_DEPTH = 20;

export interface ResolvedPreset {
  record: unknown;
  patches: unknown[];
}

/**
 * Follows body_json.base up to the root ({ recipe_pose }) row and flattens the patches of
 * every promote hop along the way, oldest first — the shape the worker's graph compiler
 * needs to fold into one prompt (docs/domain-model.md「Preset」body の形). Depth is capped
 * well above any real chain length, as a guard against a corrupted or cyclic base reference.
 */
export async function resolvePreset(db: D1Database, row: PresetRow): Promise<ResolvedPreset> {
  const bodies: PresetBody[] = [];
  let current = row;

  for (let depth = 0; depth < MAX_RESOLVE_DEPTH; depth++) {
    const body = presetBodySchema.parse(JSON.parse(current.body_json));
    bodies.push(body);

    if ('recipe_pose' in body) {
      const patches: unknown[] = [];
      for (let i = bodies.length - 2; i >= 0; i--) {
        const hop = bodies[i];
        if (hop && 'patches' in hop) patches.push(...hop.patches);
      }
      return { record: body, patches };
    }

    const { base } = body;
    const baseRow = await getPresetRow(db, base.recipe, base.kind, base.name, base.version);
    if (!baseRow) {
      throw conflict(`preset base missing: ${base.recipe}/${base.kind}/${base.name}@${base.version}`);
    }
    current = baseRow;
  }

  throw conflict(`preset base chain too deep (> ${MAX_RESOLVE_DEPTH}): ${row.recipe}/${row.kind}/${row.name}@${row.version}`);
}

/** The JSON shape both GET /presets/{recipe}/{kind}/{name}/{version} and MCP get_preset return. */
export function serializeResolvedPreset(row: PresetRow, resolved: ResolvedPreset) {
  return { ...summarizePreset(row), ...resolved };
}

/** The `{kind, name, version}[]` pinned onto `payload.generation.presets`, if any (set by pinPresets at request-creation time). */
export function extractPins(payload: unknown): { kind: string; name: string; version: number }[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const generation = (payload as Record<string, unknown>).generation;
  if (!generation || typeof generation !== 'object') return undefined;
  const presets = (generation as Record<string, unknown>).presets;
  return Array.isArray(presets) ? (presets as { kind: string; name: string; version: number }[]) : undefined;
}
