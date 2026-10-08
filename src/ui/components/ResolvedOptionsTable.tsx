import { DOF_VIEWFINDER_LABELS, LIGHT_FROM_CHOICES, LIGHT_SCENE_LABELS } from './OptionControls';

const LIGHT_FROM_LABELS: Record<string, string> = Object.fromEntries(LIGHT_FROM_CHOICES);

const OPTION_LABELS: Record<string, string> = {
  method: '方法',
  deliver_only: 'deliver only',
  denoise: 'denoise',
  size: 'size',
  route: 'route',
  keep_regions: '残す範囲',
  keep_strength: 'keep strength',
  scene: '光源',
  from: '光の向き',
  hires: 'hires',
  hires_denoise: 'hires denoise',
  repin: 'repin',
  recolor: 'recolor',
  skin: 'skin',
  keep_legwear: 'keep legwear',
  backdrop: '背景',
  light: '光源',
  stroke_light: '紫縁',
  outlines: 'フチ',
  repair: '部分描き直し',
  repair_regions: '描き直す範囲',
  repair_pad: 'repair pad',
  repair_lora: 'repair lora',
  repair_seeds: 'repair seeds',
  repair_denoise: 'repair denoise',
};

type Row = [label: string, value: string];

function formatScalar(value: unknown): string {
  if (value === true) return 'ON';
  if (value === false) return 'OFF';
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return JSON.stringify(value);
}

function directionLabel(value: unknown): string {
  return typeof value === 'string' ? (LIGHT_FROM_LABELS[value] ?? value) : formatScalar(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionRows(key: string, value: unknown): Row[] {
  const label = OPTION_LABELS[key] ?? key;
  if (key === 'dof' && isRecord(value)) {
    const rows: Row[] = [['F値', `F${formatScalar(value.f_number)}`]];
    if (Array.isArray(value.focus) && value.focus.length === 2) {
      rows.push(['ピント位置', `x ${formatScalar(value.focus[0])} · y ${formatScalar(value.focus[1])}`]);
    }
    if (value.scope !== undefined) rows.push(['ボケの範囲', value.scope === 'all' ? '背景も' : formatScalar(value.scope)]);
    if (typeof value.viewfinder === 'string') {
      rows.push(['ファインダー', DOF_VIEWFINDER_LABELS[value.viewfinder] ?? value.viewfinder]);
    }
    return rows;
  }
  if (key === 'focus' && Array.isArray(value) && value.length === 2) {
    return [['ピント位置', `x ${formatScalar(value[0])} · y ${formatScalar(value[1])}`]];
  }
  if (key === 'f_number') return [['F値', `F${formatScalar(value)}`]];
  if (key === 'viewfinder' && typeof value === 'string') return [['ファインダー', DOF_VIEWFINDER_LABELS[value] ?? value]];
  if (key === 'scope' && isRecord(value)) {
    const layers = ([['figure', '人物'], ['outline', 'フチ'], ['backdrop', '背景']] as const).filter(([layer]) => value[layer] !== false);
    return [['ボカす範囲', layers.map(([, name]) => name).join(' + ')]];
  }
  if (key === 'outlines' && Array.isArray(value)) {
    if (value.length === 0) return [[label, 'なし']];
    return [[label, value.map((o) => (isRecord(o) ? `${formatScalar(o.color)} ${formatScalar(o.width)}%` : formatScalar(o))).join(' → ')]];
  }
  if (key === 'light' && isRecord(value)) {
    const scene = typeof value.scene === 'string' ? (LIGHT_SCENE_LABELS[value.scene] ?? value.scene) : formatScalar(value.scene);
    return [[label, `${scene}（${directionLabel(value.from)}）`]];
  }
  if (key === 'from') return [[label, directionLabel(value)]];
  if (key === 'scene' && typeof value === 'string') return [[label, LIGHT_SCENE_LABELS[value] ?? value]];
  if (key === 'stroke_light') {
    if (value === 'even') return [[label, '均等']];
    if (value === 'none') return [[label, '無し']];
    if (typeof value === 'string') return [[label, `立体（${directionLabel(value)}）`]];
  }
  if (key === 'backdrop') {
    if (value === null) return [[label, '透過 PNG']];
    if (typeof value === 'string' && value.startsWith('#')) return [[label, `単色 ${value}`]];
  }
  if ((key === 'repair_regions' || key === 'keep_regions') && Array.isArray(value)) return [[label, `${value.length} 箇所`]];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return [[label, value.join(' + ')]];
  return [[label, formatScalar(value)]];
}

/** `仕上げの解決値`: the worker-resolved options as readable rows, with the raw requested/resolved JSON folded below. */
export function ResolvedOptionsTable({
  requested,
  resolved,
}: {
  requested: Record<string, unknown> | null;
  resolved: Record<string, unknown>;
}) {
  const rows = Object.entries(resolved).flatMap(([key, value]) => optionRows(key, value));
  return (
    <>
      <table class="kv-table resolved-options">
        {rows.map(([label, value]) => (
          <tr>
            <td>{label}</td>
            <td>{value}</td>
          </tr>
        ))}
      </table>
      <details class="section-sub">
        <summary>Raw JSON</summary>
        <pre>{JSON.stringify({ requested: requested ?? {}, resolved }, null, 2)}</pre>
      </details>
    </>
  );
}
