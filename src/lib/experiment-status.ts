import type { ExperimentStatus } from '../types';

export const EXPERIMENT_STATUSES = ['active', 'stabilized', 'promoted', 'abandoned'] as const;

/**
 * 検証テーマとしての Experiment の状態遷移。`active` を離れた時点で
 * `completed_at` が立ち、`active` へ戻すと消える（再開できる）。
 * `stabilized -> promoted` では最初に完了した時刻を保つ。
 */
export const EXPERIMENT_STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  active: ['stabilized', 'abandoned'],
  stabilized: ['promoted', 'active', 'abandoned'],
  promoted: ['active'],
  abandoned: ['active'],
};

/** `current` followed by its allowed targets — current first, so a select's default option is the current status. */
export function allowedNextStatuses(current: ExperimentStatus): ExperimentStatus[] {
  return [current, ...EXPERIMENT_STATUS_TRANSITIONS[current]];
}
