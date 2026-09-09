// Preset のクエリ。REST (src/routes/presets.ts) と MCP tools `list_presets` /
// `get_preset` (src/mcp.ts) の両方がここを呼ぶ。段階 A の範囲は読み取りと catalog
// からの取り込みだけ — 版の pin、受領時 lint、promote は段階 B (docs/worker-protocol.md
// 「preset の移行」)。

import { nowIso } from './db';
import { getCatalog } from './catalogs';
import { conflict, notFound } from './errors';
import { presetBodySchema, type PresetBody } from '../schemas/presets';
import { uuidv7 } from './uuidv7';
import type { PresetKind, PresetRow, PresetSource, PresetStatus } from '../types';

const CATALOG_KIND_MAP: Record<string, PresetKind> = {
  poses: 'pose',
  costumes: 'costume',
  expressions: 'expression',
};

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
    `INSERT INTO presets (id, recipe, kind, name, version, body_json, status, source, source_generation_id, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const recipe of found.doc.recipes) {
    const r = recipe as Record<string, unknown>;
    if (typeof r.name !== 'string') continue;
    const recipeName = r.name;

    for (const [catalogKey, kind] of Object.entries(CATALOG_KIND_MAP)) {
      const entries = r[catalogKey];
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
          body_json: JSON.stringify({ record: entry }),
          status: 'active',
          source: 'import',
          source_generation_id: null,
          note: null,
          created_by: 'system',
          created_at: now,
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
          ),
        );
        imported.push(summarizePreset(row));
      }
    }
  }

  if (inserts.length > 0) await db.batch(inserts);

  return { imported, skipped };
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
 * Follows body_json.base up to the root ({ record }) row and flattens the patches of every
 * promote hop along the way, oldest first — the shape the worker's graph compiler needs to
 * fold into one prompt (docs/domain-model.md「Preset」body の形). Depth is capped well above
 * any real chain length, as a guard against a corrupted or cyclic base reference.
 */
export async function resolvePreset(db: D1Database, row: PresetRow): Promise<ResolvedPreset> {
  const bodies: PresetBody[] = [];
  let current = row;

  for (let depth = 0; depth < MAX_RESOLVE_DEPTH; depth++) {
    const body = presetBodySchema.parse(JSON.parse(current.body_json));
    bodies.push(body);

    if ('record' in body) {
      const patches: unknown[] = [];
      for (let i = bodies.length - 2; i >= 0; i--) {
        const hop = bodies[i];
        if (hop && 'patches' in hop) patches.push(...hop.patches);
      }
      return { record: body.record, patches };
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
