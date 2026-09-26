// REST (src/routes/catalogs.ts) と MCP tools `list_catalog`/`get_catalog_pose` の両方がここを呼ぶ。recipe_ref ごとに最新の1件だけ保持する。

import { nowIso } from './db';
import type { RecipeCatalogDoc } from '../schemas/catalogs';
import type { RecipeCatalogRow } from '../types';

function extractNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      names.push(item);
    } else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string') {
      names.push((item as Record<string, unknown>).name as string);
    }
  }
  return names;
}

export async function putCatalog(
  db: D1Database,
  recipeRef: string,
  doc: RecipeCatalogDoc,
  workerId?: string,
): Promise<RecipeCatalogRow> {
  const now = nowIso();
  const existing = await db
    .prepare('SELECT published_at FROM recipe_catalogs WHERE recipe_ref = ?')
    .bind(recipeRef)
    .first<{ published_at: string }>();
  const publishedAt = existing?.published_at ?? now;

  await db
    .prepare(
      `INSERT INTO recipe_catalogs (recipe_ref, catalog_json, git_commit, git_branch, worker_id, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (recipe_ref) DO UPDATE SET
         catalog_json = excluded.catalog_json,
         git_commit = excluded.git_commit,
         git_branch = excluded.git_branch,
         worker_id = excluded.worker_id,
         updated_at = excluded.updated_at`,
    )
    .bind(recipeRef, JSON.stringify(doc), doc.git_commit ?? null, doc.git_branch ?? null, workerId ?? null, publishedAt, now)
    .run();

  const row = await db.prepare('SELECT * FROM recipe_catalogs WHERE recipe_ref = ?').bind(recipeRef).first<RecipeCatalogRow>();
  return row!;
}

export interface CatalogWithDoc {
  row: RecipeCatalogRow;
  doc: RecipeCatalogDoc;
}

export async function getCatalog(db: D1Database, recipeRef: string): Promise<CatalogWithDoc | null> {
  const row = await db.prepare('SELECT * FROM recipe_catalogs WHERE recipe_ref = ?').bind(recipeRef).first<RecipeCatalogRow>();
  if (!row) return null;
  return { row, doc: JSON.parse(row.catalog_json) as RecipeCatalogDoc };
}

export interface CatalogListItem extends ReturnType<typeof summarizeCatalog> {
  recipe_ref: string;
  worker_id: string | null;
  published_at: string;
  updated_at: string;
}

/** Every published catalog as its prompt-free summary, plus when it was first published and last replaced. */
export async function listCatalogs(db: D1Database): Promise<CatalogListItem[]> {
  const { results } = await db
    .prepare('SELECT * FROM recipe_catalogs ORDER BY recipe_ref ASC')
    .all<RecipeCatalogRow>();

  return (results ?? []).map((r) => ({
    recipe_ref: r.recipe_ref,
    worker_id: r.worker_id,
    published_at: r.published_at,
    updated_at: r.updated_at,
    ...summarizeCatalog(JSON.parse(r.catalog_json) as RecipeCatalogDoc),
  }));
}

/**
 * Recipe names, pose/costume/expression NAMES, prompt part names, bare `identity_tags`,
 * `parameters`, `patches` vocabulary and git info — no prompt bodies. What `list_catalog` and the
 * PUT response return; `get_catalog_pose` returns the full pose record via `findCatalogPose` instead.
 */
export function summarizeCatalog(doc: RecipeCatalogDoc) {
  const recipes = doc.recipes.map((recipe) => {
    const r = recipe as Record<string, unknown>;
    const summary: Record<string, unknown> = { name: r.name, poses: extractNames(r.poses) };
    if ('costumes' in r) summary.costumes = extractNames(r.costumes);
    if ('expressions' in r) summary.expressions = extractNames(r.expressions);
    if ('parts' in r) summary.parts = r.parts;
    if ('identity_tags' in r) summary.identity_tags = r.identity_tags;
    if ('parameters' in r) summary.parameters = r.parameters;
    // dials: {finalize?, repair?, patches?} の word -> number map。chimera は表示にしか使わず、
    // word の実在確認や number への解決は worker が行う (docs/worker-protocol.md「finalize profile」)。
    if ('dials' in r) summary.dials = r.dials;
    return summary;
  });
  const backdrops = findBackdrops(doc);
  return {
    recipes,
    patches: doc.patches,
    git_commit: doc.git_commit ?? null,
    git_branch: doc.git_branch ?? null,
    generated_at: doc.generated_at ?? null,
    // name + label only — thumbnail の base64 は summary から常に落とす (PUT 応答 / GET 一覧 / MCP list_catalog 共通)。
    ...(backdrops.length > 0 ? { backdrops: backdrops.map(({ name, label }) => ({ name, label })) } : {}),
  };
}

export interface CatalogBackdrop {
  name: string;
  label: string;
  thumbnail: string;
}

/** Top-level `backdrops` (comfyui-recipes の斜めストライプ等のパターン一覧、サムネイル付き)。キーが無い旧カタログでは空配列。 */
export function findBackdrops(doc: RecipeCatalogDoc): CatalogBackdrop[] {
  const raw = (doc as { backdrops?: unknown }).backdrops;
  if (!Array.isArray(raw)) return [];
  const result: CatalogBackdrop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, label, thumbnail } = item as Record<string, unknown>;
    if (typeof name === 'string' && typeof label === 'string' && typeof thumbnail === 'string') {
      result.push({ name, label, thumbnail });
    }
  }
  return result;
}

/** Decodes `name`'s `data:image/png;base64,...` thumbnail to raw PNG bytes. null when `name` isn't published or the data URI is malformed — the route's caller turns that into a 404. */
export function decodeBackdropThumbnail(doc: RecipeCatalogDoc, name: string): Uint8Array | null {
  const backdrop = findBackdrops(doc).find((b) => b.name === name);
  if (!backdrop) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(backdrop.thumbnail);
  if (!match) return null;
  try {
    const binary = atob(match[1]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** `recipes[].dials.finalize` for one recipe name — the word -> number map FinalizeFields renders as buttons. null when the catalog, recipe, or its dials.finalize are absent. */
export function findFinalizeDials(doc: RecipeCatalogDoc, recipeName: string): Record<string, Record<string, number>> | null {
  const recipe = doc.recipes.find((r) => (r as { name: string }).name === recipeName);
  if (!recipe) return null;
  const dials = (recipe as { dials?: { finalize?: unknown } }).dials;
  const finalize = dials?.finalize;
  return finalize && typeof finalize === 'object' && !Array.isArray(finalize) ? (finalize as Record<string, Record<string, number>>) : null;
}

export type FinalizeDefaults = Record<string, unknown>;

/** `recipes[].finalize.defaults` for one recipe name — the booleans FinalizeFields presets its checkboxes from. null when the catalog, recipe, or its finalize.defaults are absent. */
export function findFinalizeDefaults(doc: RecipeCatalogDoc, recipeName: string): FinalizeDefaults | null {
  const recipe = doc.recipes.find((r) => (r as { name: string }).name === recipeName);
  if (!recipe) return null;
  const finalize = (recipe as { finalize?: { defaults?: unknown } }).finalize;
  const defaults = finalize?.defaults;
  return defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? (defaults as FinalizeDefaults) : null;
}

/** Looks up a single pose record (full body, prompts included) by recipe name + pose name. Either miss returns null. */
export function findCatalogPose(doc: RecipeCatalogDoc, recipeName: string, poseName: string): unknown | null {
  const recipe = doc.recipes.find((r) => (r as { name: string }).name === recipeName);
  if (!recipe) return null;
  const poses = (recipe as { poses?: unknown }).poses;
  if (!Array.isArray(poses)) return null;
  for (const pose of poses) {
    if (typeof pose === 'string' && pose === poseName) return pose;
    if (pose && typeof pose === 'object' && (pose as Record<string, unknown>).name === poseName) return pose;
  }
  return null;
}
