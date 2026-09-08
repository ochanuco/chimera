// Recipe catalog のクエリ。REST (src/routes/catalogs.ts) と MCP tools
// `list_catalog` / `get_catalog_pose` (src/mcp.ts) の両方がここを呼ぶ。
// recipe_ref ごとに最新の1件だけを保持する (migrations/0014_recipe_catalogs.sql)。

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
 * Recipe names, pose/costume/expression NAMES, `parameters`, the `patches` vocabulary and git
 * info — no prompt bodies. What `list_catalog` and the PUT response return; `get_catalog_pose`
 * returns the full pose record (prompt bodies included) via `findCatalogPose` instead.
 */
export function summarizeCatalog(doc: RecipeCatalogDoc) {
  const recipes = doc.recipes.map((recipe) => {
    const r = recipe as Record<string, unknown>;
    const summary: Record<string, unknown> = { name: r.name, poses: extractNames(r.poses) };
    if ('costumes' in r) summary.costumes = extractNames(r.costumes);
    if ('expressions' in r) summary.expressions = extractNames(r.expressions);
    if ('parameters' in r) summary.parameters = r.parameters;
    return summary;
  });
  return {
    recipes,
    patches: doc.patches,
    git_commit: doc.git_commit ?? null,
    git_branch: doc.git_branch ?? null,
    generated_at: doc.generated_at ?? null,
  };
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
