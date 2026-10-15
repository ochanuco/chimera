// Request の payload・作成にかかる規則と定数。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import type { ValidationIssue } from './validate';

/** worker-protocol.md: `recipe_ref` は origin のブランチ名相当の文字列だけを検証し、存在は確認しない。 */
export const RECIPE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/** catalog の `dials` が定義する word の語彙 (docs/worker-protocol.md「deliver profile」)。実在するかは worker が検証、chimera は型だけ見る。 */
export const DIAL_WORD_RE = /^[a-z][a-z0-9-]*$/;

export const MAX_OUTLINES = 6;

/** Generic masked redraw keeps its strength in the low-to-medium inpaint range. */
export const MASKED_REDRAW_MAX_DENOISE = 0.75;

export const FINALIZE_CREATION_MESSAGE =
  "kind 'finalize' can no longer be created: use 'redraw' (change the picture) or 'deliver' (cut out and finish)";

type Region = readonly [number, number, number, number];

export function regionsOverlap(a: Region, b: Region): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** masked_redraw の options: alias (`pad` / `feather`) と正規名の同時指定、region 同士の重なりを弾く。 */
export function maskedRedrawOptionsIssues(value: {
  regions: readonly Region[];
  mask_padding?: number;
  pad?: number;
  mask_feather?: number;
  feather?: number;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.mask_padding !== undefined && value.pad !== undefined) {
    issues.push({ message: 'use either mask_padding or pad, not both', path: ['mask_padding'] });
  }
  if (value.mask_feather !== undefined && value.feather !== undefined) {
    issues.push({ message: 'use either mask_feather or feather, not both', path: ['mask_feather'] });
  }
  for (let i = 0; i < value.regions.length; i += 1) {
    for (let j = i + 1; j < value.regions.length; j += 1) {
      if (regionsOverlap(value.regions[i]!, value.regions[j]!)) {
        issues.push({ message: `region overlaps region ${j}`, path: ['regions', i] });
      }
    }
  }
  return issues;
}

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

/** stage は photo の組 (place / height) と柄の組 (backdrop / shadow_from / light) を混ぜない。 */
export function stageOptionsIssues(options: {
  photo?: string;
  place?: unknown;
  height?: number;
  backdrop?: string;
  shadow_from?: unknown;
  light?: unknown;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const hasPhoto = options.photo !== undefined;
  if (!hasPhoto && (options.place !== undefined || options.height !== undefined)) {
    issues.push({ message: 'place / height are only for a photo', path: ['place'] });
  }
  if (hasPhoto && (options.backdrop !== undefined || options.shadow_from !== undefined || options.light !== undefined)) {
    issues.push({ message: 'backdrop / shadow_from / light are not for a photo', path: ['backdrop'] });
  }
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
