// plain_render (MCP) が組み立てる request.json v1 payload。preset の基準 render の pin
// (lib/preset-references.ts) を種に、recipe の既定 (patches なし) で pose を再度描く。

import { getPresetRow } from './presets';
import { getCatalog, findCatalogPose } from './catalogs';
import { getCurrentReference, referenceView, type PresetReferenceView } from './preset-references';
import { conflict, notFound } from './errors';
import type { JsonObject } from './overrides';

export interface PlainRenderInput {
  recipe: string;
  pose: string;
  seed?: number;
  idempotency_key?: string;
  recipe_ref: string;
}

export interface PlainRenderRequestBuild {
  payload: JsonObject;
  seed: number;
  idempotency_key: string;
  reference: PresetReferenceView | null;
}

/**
 * seed defaults to the pose's current basis-render pin; pass `seed` explicitly to bootstrap a
 * pose that has no pin yet. 409s when neither is available. `parameters` names only the pose:
 * the recipe applies the pose's default costume itself, and naming it here would make
 * createRequest's pinPresets demand a costume Preset, which import never creates
 * (docs/domain-model.md「Preset」body の形).
 */
export async function buildPlainRenderRequest(db: D1Database, input: PlainRenderInput): Promise<PlainRenderRequestBuild> {
  const presetRow = await getPresetRow(db, input.recipe, 'pose', input.pose);
  if (!presetRow) throw notFound(`preset '${input.recipe}/pose/${input.pose}'`);

  const found = await getCatalog(db, input.recipe_ref);
  if (!found) throw notFound(`recipe catalog '${input.recipe_ref}'`);
  const record = findCatalogPose(found.doc, input.recipe, input.pose);
  if (!record) throw notFound(`pose '${input.pose}' in recipe '${input.recipe}'`);

  const reference = await referenceView(db, await getCurrentReference(db, input.recipe, 'pose', input.pose));

  const seed = input.seed ?? reference?.seed;
  if (seed === undefined) {
    throw conflict(`no reference pinned for ${input.recipe}/${input.pose}; pass seed or set_pose_reference first`);
  }

  const payload: JsonObject = {
    schema_version: 1,
    request: { count: 1, instruction: `plain ${input.pose}`, seeds: [seed] },
    generation: { recipe: input.recipe, parameters: { pose: input.pose } },
    semantic: { summary: `plain render of ${input.recipe} ${input.pose}: recipe defaults, no patches, seed ${seed}` },
  };

  const idempotencyKey = input.idempotency_key ?? `plain:${input.recipe}:${input.pose}:${seed}:${found.row.git_commit ?? 'unknown'}`;

  return { payload, seed, idempotency_key: idempotencyKey, reference };
}
