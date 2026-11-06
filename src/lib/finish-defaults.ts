// deliver / stage の options の既定の語を、Request の作成時に実際の値へ置き換える
// (docs/worker-protocol.md「柄のランダム」「既定の枠」)。保存される payload と worker が読む payload には置き換えた後の値だけが残る。
import { getGenerationByIdOrShortId } from './db';
import { findBackdrops, getCatalog } from './catalogs';
import { badRequest, notFound } from './errors';
import { DEFAULT_FRAME, DEFAULT_STAGE_FRAME, RANDOM_BACKDROP } from './request-rules';
import type { JsonObject } from './overrides';
import type { GenerationRow, RequestKind } from '../types';

const MAX_ROOT_HOPS = 100;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface FinishDefaultsContext {
  kind: RequestKind;
  recipeRef: string;
  idempotencyKey: string;
}

/**
 * `options.backdrop: "random"`（deliver / stage）を絵の recipe の柄の 1 つに、`options.frame: "default"`（stage）を
 * DEFAULT_STAGE_FRAME に置き換える。柄は idempotency_key のハッシュで選ぶので、同じキーの再送は同じ柄になり、既存行の再送として返る。
 * どちらの語も無ければ payload をそのまま返す。
 */
export async function applyFinishDefaults(db: D1Database, payload: JsonObject, context: FinishDefaultsContext): Promise<JsonObject> {
  if (context.kind !== 'deliver' && context.kind !== 'stage') return payload;
  const options = payload.options;
  if (!isJsonObject(options)) return payload;
  const wantsRandom = options.backdrop === RANDOM_BACKDROP;
  const wantsFrame = context.kind === 'stage' && options.frame === DEFAULT_FRAME;
  if (!wantsRandom && !wantsFrame) return payload;

  const next: JsonObject = { ...options };
  if (wantsFrame) next.frame = structuredClone(DEFAULT_STAGE_FRAME) as unknown as JsonObject;
  if (wantsRandom) next.backdrop = await pickBackdrop(db, payload.generation_id, context);
  return { ...payload, options: next };
}

async function pickBackdrop(db: D1Database, generationId: unknown, context: FinishDefaultsContext): Promise<string> {
  if (typeof generationId !== 'string') throw badRequest('backdrop "random" requires a generation_id');
  const generation = await getGenerationByIdOrShortId(db, generationId);
  if (!generation) throw notFound('generation');
  const recipe = await rootRecipe(db, generation);
  const catalog = await getCatalog(db, context.recipeRef);
  const names = catalog ? findBackdrops(catalog.doc, recipe).map((b) => b.name) : [];
  if (names.length === 0) {
    throw badRequest(`backdrop "random" needs backdrop patterns in catalog '${context.recipeRef}', and it publishes none`);
  }
  return names[(await keyHash(context.idempotencyKey)) % names.length]!;
}

/** 仕上げ元を raw Generation までさかのぼり、それを描いた Request の recipe を返す。 */
async function rootRecipe(db: D1Database, generation: GenerationRow): Promise<string | null> {
  let current = generation;
  for (let hop = 0; hop < MAX_ROOT_HOPS && current.refines_generation_id; hop += 1) {
    const parent = await db.prepare('SELECT * FROM generations WHERE id = ?').bind(current.refines_generation_id).first<GenerationRow>();
    if (!parent) break;
    current = parent;
  }
  if (!current.request_id) return null;
  const owner = await db.prepare('SELECT recipe FROM requests WHERE id = ?').bind(current.request_id).first<{ recipe: string | null }>();
  return owner?.recipe ?? null;
}

async function keyHash(key: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return new DataView(digest).getUint32(0);
}
