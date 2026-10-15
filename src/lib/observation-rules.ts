// Observation の入力にかかる規則。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import type { ValidationIssue } from './validate';

/** pose/component の一方必須という不変条件 (docs/domain-model.md「Observation」)。 */
export function poseOrComponentIssues(value: { pose?: string; component?: string }): ValidationIssue[] {
  if (!value.pose && !value.component) {
    return [{ message: 'pose か component の少なくとも一方が必要です', path: ['pose'] }];
  }
  return [];
}
