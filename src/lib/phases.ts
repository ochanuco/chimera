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

/** generate〜dof はワークベンチのフェーズ名に揃える（generate はワークベンチの元絵）。 */
export const PHASE_LABELS: Record<Phase, string> = {
  generate: '元絵',
  import: '取り込み',
  redraw: '描き直し',
  deliver: 'フチ',
  saturation: '彩度',
  stage: '背景',
  lighting: '光',
  dof: 'ボケ',
  lens: 'レンズ',
  photo: '写真合成',
};

/** Gallery のフェーズボタンの並び。chain はワークベンチの順に › でつなぎ、extra は連鎖の外に置く。 */
export const PHASE_CHAIN = ['generate', 'redraw', 'deliver', 'saturation', 'stage', 'lighting', 'dof'] as const satisfies readonly Phase[];
export const PHASE_EXTRA = ['lens', 'photo', 'import'] as const satisfies readonly Phase[];

export function isPhase(value: string): value is Phase {
  return Object.hasOwn(PHASE_KINDS, value);
}
