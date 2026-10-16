// ワークベンチの入力にかかる規則と定数。スキーマ宣言から呼ばれるので schemas にも検証ライブラリにも依存しない。

import type { ValidationIssue } from './validate';

export const WORKBENCH_PHASES = ['1', '2', '3', '4', '5'] as const;

export function workbenchPicksIssues(picks: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(picks)) {
    if (!(WORKBENCH_PHASES as readonly string[]).includes(key)) {
      issues.push({ message: `phase key must be one of 1..5, got '${key}'`, path: [key] });
    }
  }
  return issues;
}
