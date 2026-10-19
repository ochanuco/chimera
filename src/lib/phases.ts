import type { RequestKind } from '../types';

/** Gallery の「フェーズ」絞り込み値と、それが指す request.kind (docs/ui.md「Gallery」)。 */
export const PHASE_KINDS = {
  generate: ['generate', 'finalize'],
  import: ['import'],
  redraw: ['redraw', 'repair', 'masked_redraw'],
  deliver: ['deliver'],
  saturation: ['saturation'],
  stage: ['stage'],
  lighting: ['lighting'],
  dof: ['dof'],
  lens: ['lens'],
  photo: ['photo'],
} as const satisfies Record<string, readonly RequestKind[]>;

export type Phase = keyof typeof PHASE_KINDS;

export const PHASES = Object.keys(PHASE_KINDS) as [Phase, ...Phase[]];

export const PHASE_LABELS: Record<Phase, string> = {
  generate: '生成',
  import: '取り込み',
  redraw: 'redraw',
  deliver: 'deliver',
  saturation: 'saturation',
  stage: 'stage',
  lighting: 'lighting',
  dof: 'dof',
  lens: 'lens',
  photo: 'photo',
};

export function isPhase(value: string): value is Phase {
  return Object.hasOwn(PHASE_KINDS, value);
}
