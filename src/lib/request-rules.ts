// Request の payload・作成にかかる規則と定数。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import type { ValidationIssue } from './validate';

/** worker-protocol.md: `recipe_ref` は origin のブランチ名相当の文字列だけを検証し、存在は確認しない。 */
export const RECIPE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/** catalog の `dials` が定義する word の語彙 (docs/worker-protocol.md「deliver profile」)。実在するかは worker が検証、chimera は型だけ見る。 */
export const DIAL_WORD_RE = /^[a-z][a-z0-9-]*$/;

export const MAX_OUTLINES = 6;

export const MAX_FRAME_STROKES = 200;
export const MAX_FRAME_STROKE_POINTS = 2000;
export const MAX_FRAME_TOTAL_POINTS = 20000;

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** reference_render が描く土台 (docs/worker-protocol.md「reference_render」)。worker の yukari_persona（pose を持たない基本キャラクター）で、GUI からは選ばせない。 */
export const REFERENCE_RENDER_POSE = 'yukari_persona';

export const REFERENCE_RENDER_CREATION_MESSAGE =
  "kind 'reference_render' is created only by POST /api/v1/references/{id}/renders, which checks the tags against the analysis";

export const PARTIAL_FIX_CREATION_MESSAGE =
  "kinds 'repair' and 'masked_redraw' can no longer be created: use 'redraw' to change the picture (the partial-fix feature was removed)";

export const FINALIZE_CREATION_MESSAGE =
  "kind 'finalize' can no longer be created: use 'redraw' (change the picture) or 'deliver' (cut out and finish)";

type Region = readonly [number, number, number, number];

/** dof の scope は 3 層のうち 1 つは残す。 */
export function dofScopeIssues(scope: { figure?: boolean; outline?: boolean; backdrop?: boolean }): ValidationIssue[] {
  if (scope.figure === false && scope.outline === false && scope.backdrop === false) {
    return [{ message: 'scope must keep at least one layer', path: [] }];
  }
  return [];
}

/** lens の radius は shape = sphere のときだけ受ける。 */
export function lensOptionsIssues(options: { radius?: number; shape?: string }): ValidationIssue[] {
  if (options.radius !== undefined && options.shape !== 'sphere') {
    return [{ message: 'radius is only for shape "sphere"', path: ['radius'] }];
  }
  return [];
}

type FrameShape = { box?: Region; canvas?: readonly (number | null)[]; strokes?: { points: unknown[] }[] };

/** canvas の null の辺は worker が自動で埋めるので、向かい合う辺が両方数のときだけ順序を見る。 */
function rectOrdered(rect: readonly (number | null)[]): boolean {
  const [x0, y0, x1, y1] = rect;
  const ordered = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || a < b;
  return ordered(x0, x1) && ordered(y0, y1);
}

function frameIssues(frame: FrameShape): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of ['box', 'canvas'] as const) {
    const rect = frame[key];
    if (rect && !rectOrdered(rect)) {
      issues.push({ message: `frame ${key} must have x0 < x1 and y0 < y1`, path: ['frame', key] });
    }
  }
  const total = (frame.strokes ?? []).reduce((sum, stroke) => sum + stroke.points.length, 0);
  if (total > MAX_FRAME_TOTAL_POINTS) {
    issues.push({ message: `frame strokes have more than ${MAX_FRAME_TOTAL_POINTS} points in total`, path: ['frame', 'strokes'] });
  }
  return issues;
}

/** stage は photo の組 (place / height) と柄の組 (backdrop / shadow_from / light / frame) を混ぜない。 */
export function stageOptionsIssues(options: {
  photo?: string;
  place?: unknown;
  height?: number;
  backdrop?: string;
  shadow_from?: unknown;
  light?: unknown;
  frame?: unknown;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasPhoto = options.photo !== undefined;
  if (!hasPhoto && (options.place !== undefined || options.height !== undefined)) {
    issues.push({ message: 'place / height are only for a photo', path: ['place'] });
  }
  if (hasPhoto && (options.backdrop !== undefined || options.shadow_from !== undefined || options.light !== undefined)) {
    issues.push({ message: 'backdrop / shadow_from / light are not for a photo', path: ['backdrop'] });
  }
  if (hasPhoto && options.frame !== undefined) {
    issues.push({ message: 'frame is not for a photo', path: ['frame'] });
  }
  if (options.frame !== undefined) issues.push(...frameIssues(options.frame as FrameShape));
  return issues;
}

export function patchesFingerprintIssues(value: { patches?: unknown[] | null; pose_fingerprint?: string | null }): ValidationIssue[] {
  // patches があるのに fingerprint が無いと base_fingerprint が NULL になり drift 検出できなくなる (docs/domain-model.md「Preset」)。
  if ((value.patches?.length ?? 0) > 0 && !value.pose_fingerprint) {
    return [{ message: 'pose_fingerprint is required when patches is non-empty', path: ['pose_fingerprint'] }];
  }
  return [];
}

export function resolutionReferenceIssues(value: { source_generation_id?: string; generation_id?: string }): ValidationIssue[] {
  if (!value.source_generation_id && !value.generation_id) {
    return [{ message: 'source_generation_id is required', path: ['source_generation_id'] }];
  }
  return [];
}

export function updateRequestIssues(value: { status: string; worker_id?: string; result?: unknown; error?: string }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.status !== 'cancelled' && !value.worker_id) {
    issues.push({ message: 'worker_id is required for this status transition', path: ['worker_id'] });
  }
  if (value.status === 'failed' && !value.error) {
    issues.push({ message: 'error is required when status is failed', path: ['error'] });
  }
  if (value.status === 'done' && !value.result) {
    issues.push({ message: 'result is required when status is done', path: ['result'] });
  }
  return issues;
}

/** derive_request の seeds は request.json v1 (docs/generation-request.md) の request.seeds で、Job 数 = count と一致する必要がある。 */
export function deriveRequestIssues(value: { count: number; seeds?: number[] }): ValidationIssue[] {
  if (value.seeds && value.seeds.length !== value.count) {
    return [{ message: `seeds length (${value.seeds.length}) must equal count (${value.count})`, path: ['seeds'] }];
  }
  return [];
}
