// リロール: 元絵 (raw Generation) の generate payload を seed だけ変えて 4 枚振り直す。prompt も recipe も触らないので semantic 判断を伴わず、GUI が積んでよい。

import { parseJsonObject, type JsonObject } from './overrides';
import { conflict } from './errors';
import { createRequest, requestOfGeneration } from './requests';
import { findRootGeneration } from './workbench';
import type { GenerationRow, RequestRow, RequestStatus } from '../types';

export const REROLL_COUNT = 4;

export interface RerollNode {
  id: string;
  short_id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  delivered: false;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  created_at: string;
}

export interface RerollRequestView {
  id: string;
  status: RequestStatus;
  error: string | null;
  created_at: string;
}

export interface RerollState {
  root: RerollNode;
  /** null: 元絵が generate の recipe 指定でなく、振り直せない。 */
  recipe: string | null;
  request: RerollRequestView | null;
  generations: RerollNode[];
}

function nodeOf(row: Pick<GenerationRow, 'id' | 'short_id' | 'rating' | 'bookmark' | 'image_width' | 'image_height' | 'image_size' | 'created_at'>): RerollNode {
  return {
    id: row.id,
    short_id: row.short_id,
    rating: row.rating,
    bookmark: row.bookmark === 1,
    delivered: false,
    image_width: row.image_width,
    image_height: row.image_height,
    image_size: row.image_size,
    created_at: row.created_at,
  };
}

function recipeOf(request: Pick<RequestRow, 'kind' | 'payload_json'>): string | null {
  if (request.kind !== 'generate') return null;
  const generation = parseJsonObject(request.payload_json).generation;
  const recipe = (generation as { recipe?: unknown } | undefined)?.recipe;
  return typeof recipe === 'string' && recipe !== '' ? recipe : null;
}

/** 元の payload から seeds を外し、件数を 4 にする。ExperimentRun への紐付け (`experiment`) は引き継がない。 */
export function rerollPayload(source: JsonObject): JsonObject {
  const { experiment: _experiment, ...rest } = source;
  const { seeds: _seeds, ...request } = (source.request ?? {}) as JsonObject;
  return { ...rest, request: { ...request, count: REROLL_COUNT } };
}

export async function findRerollRequest(db: D1Database, rootId: string): Promise<RequestRow | null> {
  return db.prepare('SELECT * FROM requests WHERE reroll_of_generation_id = ?').bind(rootId).first<RequestRow>();
}

export async function getRerollState(db: D1Database, generation: GenerationRow): Promise<RerollState> {
  const root = await findRootGeneration(db, generation);
  const [sourceRequest, reroll] = await Promise.all([requestOfGeneration(db, root), findRerollRequest(db, root.id)]);
  const { results } = reroll
    ? await db
        .prepare(
          `SELECT id, short_id, rating, bookmark, image_width, image_height, image_size, created_at
           FROM generations WHERE request_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .bind(reroll.id)
        .all<GenerationRow>()
    : { results: [] as GenerationRow[] };
  return {
    root: nodeOf(root),
    recipe: recipeOf(sourceRequest),
    request: reroll ? { id: reroll.id, status: reroll.status, error: reroll.error, created_at: reroll.created_at } : null,
    generations: (results ?? []).map(nodeOf),
  };
}

export interface CreateRerollResult {
  row: RequestRow;
  created: boolean;
}

/** 元絵 1 枚につき 1 回だけ。既にあれば何も作らずその Request を返す (created: false)。 */
export async function createReroll(db: D1Database, generation: GenerationRow, defaultRecipeRef: string): Promise<CreateRerollResult> {
  const root = await findRootGeneration(db, generation);
  const existing = await findRerollRequest(db, root.id);
  if (existing) return { row: existing, created: false };

  const source = await requestOfGeneration(db, root);
  if (!recipeOf(source)) throw conflict(`generation '${root.short_id}' was not drawn from a generate request with a recipe; it cannot be rerolled`);

  return createRequest(
    db,
    {
      kind: 'generate',
      payload: rerollPayload(parseJsonObject(source.payload_json)),
      recipe_ref: source.recipe_ref,
      idempotency_key: `reroll:${root.id}`,
      created_by: 'gui',
      reroll_of_generation_id: root.id,
    },
    { defaultRecipeRef },
  );
}
