import type { RecipeCatalogDoc } from '../schemas/catalogs';
import { findCatalogPose } from './catalogs';
import { badRequest } from './errors';

// chagama AGENTS.md の draft と同じ規定。hires の latent 拡大は 1.4 倍程度までしか崩れずに上がらない。
const DRAFT_AREA = 1_300_000;
const MAX_DRAFT_AREA = 1_400_000;

type Patch = Record<string, unknown>;

export interface DraftCanvasInput {
  doc: RecipeCatalogDoc | null;
  recipe: unknown;
  pose: unknown;
  /** Patches carried from the parent request (empty for create_request or replace_patches). */
  inherited: Patch[];
  /** Patches the caller passed in this request. */
  own: Patch[];
  /** The field name the error message tells the caller to fill. */
  overrideField: string;
}

function lastSet(patches: Patch[], target: string): number | null {
  let value: number | null = null;
  for (const patch of patches) {
    if (patch.target === target && patch.op === 'set' && typeof patch.value === 'number') value = patch.value;
  }
  return value;
}

function poseCanvas(doc: RecipeCatalogDoc | null, recipe: unknown, pose: unknown): [number, number] | null {
  if (!doc || typeof recipe !== 'string' || typeof pose !== 'string') return null;
  const record = findCatalogPose(doc, recipe, pose);
  const canvas = record && typeof record === 'object' ? (record as { canvas?: unknown }).canvas : undefined;
  if (!Array.isArray(canvas) || canvas.length !== 2) return null;
  const [width, height] = canvas;
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? [width, height] : null;
}

/** About 1.3 MP at width:height, each side rounded down to a multiple of 8. */
export function draftSize(width: number, height: number): [number, number] {
  const ratio = width / height;
  const floor8 = (n: number) => Math.floor(n / 8) * 8;
  return [floor8(Math.sqrt(DRAFT_AREA * ratio)), floor8(Math.sqrt(DRAFT_AREA / ratio))];
}

/**
 * The render.width / render.height patches to append so the request renders a draft, or [] when it already does
 * (or its canvas cannot be resolved). A size the caller sets in this request is never rewritten: past a draft it
 * is rejected so the caller either shrinks it or names the reason in the override field.
 */
export function draftCanvasPatches(input: DraftCanvasInput): Patch[] {
  const canvas = poseCanvas(input.doc, input.recipe, input.pose);
  const ownWidth = lastSet(input.own, 'render.width');
  const ownHeight = lastSet(input.own, 'render.height');
  const width = ownWidth ?? lastSet(input.inherited, 'render.width') ?? canvas?.[0] ?? null;
  const height = ownHeight ?? lastSet(input.inherited, 'render.height') ?? canvas?.[1] ?? null;
  if (width === null || height === null || width * height <= MAX_DRAFT_AREA) return [];

  const [draftWidth, draftHeight] = draftSize(width, height);
  if (ownWidth !== null || ownHeight !== null) {
    throw badRequest(
      `render.width x render.height ${width}x${height} is larger than a draft (about 1.3 MP, ${draftWidth}x${draftHeight} ` +
        `at this aspect ratio); patch a draft size, or give the reason for this size in ${input.overrideField}`,
    );
  }
  const reason = `draft: about 1.3 MP at the ${width}x${height} aspect ratio`;
  return [
    { target: 'render.width', op: 'set', value: draftWidth, reason },
    { target: 'render.height', op: 'set', value: draftHeight, reason },
  ];
}

/**
 * `payload` with the draft canvas applied: draft patches appended to generation.patches, or, when the override reason
 * is set, the reason recorded in semantic.attributes.canvas_override (the worker copies those attributes to the
 * Generation).
 */
export function withDraftCanvas(
  payload: Record<string, unknown>,
  input: Omit<DraftCanvasInput, 'recipe' | 'pose'> & { override: string | undefined },
): Record<string, unknown> {
  const generation = (payload.generation ?? {}) as Record<string, unknown>;
  if (input.override !== undefined) {
    const semantic = (payload.semantic ?? {}) as Record<string, unknown>;
    const attributes = (semantic.attributes ?? {}) as Record<string, unknown>;
    return { ...payload, semantic: { ...semantic, attributes: { ...attributes, canvas_override: input.override } } };
  }
  const parameters = (generation.parameters ?? {}) as Record<string, unknown>;
  const added = draftCanvasPatches({ ...input, recipe: generation.recipe, pose: parameters.pose });
  if (added.length === 0) return payload;
  const patches = Array.isArray(generation.patches) ? (generation.patches as Patch[]) : [];
  return { ...payload, generation: { ...generation, patches: [...patches, ...added] } };
}
