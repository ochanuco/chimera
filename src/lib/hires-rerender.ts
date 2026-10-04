import { conflict } from './errors';
import { parseJsonObjectOrNull } from './overrides';
import { recipeHasPresets } from './presets';
import { buildDerivedRequestPayload, resolveDerivationSource } from './requests';
import type { GenerationRow } from '../types';

export const HIRES_LONG_SIDE = 2048;

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Generation Detail に hires 刷り直しを出せるか。recipe-mode の raw 起点に遡れるときだけ true。original の purge は無関係 (prompt から再生成する)。 */
export async function canHiresRerender(db: D1Database, generation: GenerationRow): Promise<boolean> {
  try {
    const { request } = await resolveDerivationSource(db, generation);
    return Boolean(request.recipe);
  } catch {
    return false;
  }
}

/**
 * 同じ prompt・同じ seed の generate payload に generation 段の hires を足す。canvas は直接変えない
 * (同 seed でサイズだけ変えると構図が変わる)。parameters.hires + hires.denoise は latent upscale のあと同 seed で
 * 通し直す指定で、recipe / parameters / patches は元 Request から引き継ぐだけ。
 */
export async function buildHiresRerenderPayload(db: D1Database, requested: GenerationRow, denoise: number) {
  const { generation: source, request: sourceRequest } = await resolveDerivationSource(db, requested);

  let seed = source.seed;
  if (seed === null) {
    const job = await db.prepare('SELECT seed FROM comfy_jobs WHERE id = ?').bind(source.comfy_job_id).first<{ seed: number | null }>();
    seed = job?.seed ?? null;
  }
  if (seed === null) throw conflict(`generation '${source.short_id}' has no recorded seed; cannot re-render at the same seed`);

  const instruction = `hires ${HIRES_LONG_SIDE} (denoise ${denoise}) of ${source.short_id}`;
  return buildDerivedRequestPayload({
    parentGenerationId: source.id,
    requestedGenerationId: requested.id,
    parentRecipe: sourceRequest.recipe,
    parentParameters: parseJsonObjectOrNull(sourceRequest.parameters_json) ?? {},
    parentPatches: parseJsonArray(sourceRequest.patches_json),
    parentPresets: parseJsonArray(sourceRequest.preset_versions_json) as { kind: string; name: string; version: number }[],
    parentRecipeHasPresets: sourceRequest.recipe ? await recipeHasPresets(db, sourceRequest.recipe) : false,
    instruction,
    count: 1,
    seeds: [seed],
    parameters: { hires: HIRES_LONG_SIDE },
    patches: [{ target: 'hires.denoise', op: 'set', value: denoise }],
    replacePatches: false,
    semantic: { summary: instruction },
  });
}
