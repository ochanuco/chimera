import { getGenerationByIdOrShortId } from './db';
import { findProducingRequest } from './requests';
import type { GenerationRow } from '../types';

export const FRAME_LAYER_ROLES = ['layer-figure', 'layer-outline'] as const;

export interface FrameSource {
  /** 枠に入れる納品画像。枠つきの stage 出力を開いたときは、その stage の入力。 */
  base: GenerationRow;
  /** 枠つきの stage 出力を開いたときの、その request の options（frame / backdrop / shadow_from）。 */
  initial: Record<string, unknown> | null;
  hasLayers: boolean;
}

/** `/frame/:shortId` が編集する base と初期状態を決める。枠つきの stage 出力なら、その request が復元元になる。 */
export async function resolveFrameSource(db: D1Database, generation: GenerationRow): Promise<FrameSource> {
  let base = generation;
  let initial: Record<string, unknown> | null = null;
  const producing = await findProducingRequest(db, generation.id);
  if (producing?.kind === 'stage') {
    const payload = JSON.parse(producing.payload_json) as { generation_id?: string; options?: Record<string, unknown> };
    const options = payload.options;
    const source = options?.frame && payload.generation_id ? await getGenerationByIdOrShortId(db, payload.generation_id) : null;
    if (options && source) {
      base = source;
      initial = {};
      for (const key of ['frame', 'backdrop', 'shadow_from']) {
        if (options[key] !== undefined) initial[key] = options[key];
      }
    }
  }
  const { results } = await db
    .prepare(`SELECT role FROM generation_assets WHERE generation_id = ? AND region = '' AND role IN (?, ?)`)
    .bind(base.id, ...FRAME_LAYER_ROLES)
    .all<{ role: string }>();
  return { base, initial, hasLayers: results.length === FRAME_LAYER_ROLES.length };
}
