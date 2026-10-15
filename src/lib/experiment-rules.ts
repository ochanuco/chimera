// Experiment / Run の入力にかかる規則。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import { prefixIssues, type ValidationIssue } from './validate';

/** create_experiment の parameters と seeds を、Experiment に保存する base_parameters にまとめる。 */
export function mergedBaseParameters(input: { parameters?: Record<string, unknown>; seeds?: number[] }): Record<string, unknown> {
  return { ...(input.parameters ?? {}), ...(input.seeds ? { seeds: input.seeds } : {}) };
}

type IssuePath = (string | number)[];

export function patchesShapeIssues(patches: unknown, basePath: IssuePath): ValidationIssue[] {
  if (!Array.isArray(patches)) {
    return [{ message: 'must be an array of patch objects, e.g. [{ target, op, reason, value? }]', path: basePath }];
  }
  const issues: ValidationIssue[] = [];
  patches.forEach((patch, i) => {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      issues.push({ message: 'each patch must be an object with target, op and reason', path: [...basePath, i] });
      return;
    }
    for (const field of ['target', 'op', 'reason'] as const) {
      const fieldValue = (patch as Record<string, unknown>)[field];
      if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
        issues.push({ message: 'must be a non-empty string', path: [...basePath, i, field] });
      }
    }
  });
  return issues;
}

export function overridesIssues(value: Record<string, unknown>): ValidationIssue[] {
  const unexpected = Object.keys(value).filter((k) => k !== 'patches');
  if (unexpected.length > 0) {
    return [
      {
        message:
          `must be {} or {"patches": [...]}; unexpected key(s): ${unexpected.join(', ')}. ` +
          "Generation parameters (pose, costume, count, ...) belong to the Experiment's base_parameters, not to a Run's overrides.",
        path: [],
      },
    ];
  }
  if (!('patches' in value)) return [];
  return patchesShapeIssues(value.patches, ['patches']);
}

/** seeds は 1〜16 個の非負整数。 */
function isSeedList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 16 &&
    value.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
  );
}

export function baseParametersIssues(value: Record<string, unknown>): ValidationIssue[] {
  if (!('seeds' in value)) return [];
  const seeds = value.seeds;
  if (!isSeedList(seeds)) {
    return [{ message: 'must be an array of 1-16 non-negative integers', path: ['seeds'] }];
  }
  if ('count' in value && value.count !== seeds.length) {
    return [
      {
        message: `count (${String(value.count)}) must equal seeds length (${seeds.length}); omit count when seeds is given`,
        path: ['count'],
      },
    ];
  }
  return [];
}

/** create_experiment: arm の label は呼び出し内で一意、parameters と seeds をまとめた base_parameters は REST と同じ規則を通す。 */
export function createExperimentInputIssues(value: {
  arms: { label: string }[];
  parameters?: Record<string, unknown>;
  seeds?: number[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  value.arms.forEach((arm, i) => {
    if (seen.has(arm.label)) {
      issues.push({ message: `duplicate arm label '${arm.label}'`, path: ['arms', i, 'label'] });
    }
    seen.add(arm.label);
  });
  issues.push(...prefixIssues(['parameters'], baseParametersIssues(mergedBaseParameters(value))));
  return issues;
}
