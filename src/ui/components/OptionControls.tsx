export const LIGHT_SCENE_LABELS: Record<string, string> = { sunset: '夕日', moon: '月明かり' };

export const LIGHT_FROM_CHOICES: [string, string][] = [
  ['nw', '左上から'],
  ['n', '上から'],
  ['ne', '右上から'],
  ['w', '左から'],
  ['e', '右から'],
  ['sw', '左下から'],
  ['s', '下から'],
  ['se', '右下から'],
];

export const DOF_VIEWFINDER_LABELS: Record<string, string> = { off: 'OFF', on: 'ON', both: 'ON/OFF 2枚' };

/** The request kinds a Generation Detail request list can show, with their badge labels. */
export const REQUEST_KIND_LABELS: Record<string, string> = {
  redraw: '描き直し',
  deliver: '納品',
  dof: 'ボケ',
  repair: 'repair',
  masked_redraw: 'masked redraw',
  finalize: 'finalize',
};
