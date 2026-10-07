import type { DofCatalog } from '../../lib/catalogs';
import { Help } from './OptionControls';

export interface DofFormData {
  dof: DofCatalog | null;
}

/** Used by the workbench when the published catalog has no top-level `dof` section. */
export const FALLBACK_DOF: DofCatalog = {
  min: 1.4,
  max: 22,
  default: 2.8,
  stops: [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22],
  scope: { figure: true, outline: true, backdrop: true },
  viewfinder: { values: ['off', 'on', 'both'], default: 'off' },
  focus: null,
  guideRadiusPerF: null,
};

const SCOPE_LAYERS = [
  ['figure', '人物'],
  ['outline', 'フチ'],
  ['backdrop', '背景'],
] as const;
const VIEWFINDER_LABELS: Record<string, string> = { off: 'なし', on: 'あり', both: '両方' };

export function nearestStopIndex(stops: number[], value: number): number {
  let best = 0;
  stops.forEach((s, i) => {
    if (Math.abs(s - value) < Math.abs(stops[best]! - value)) best = i;
  });
  return best;
}

/** Focus point, F number, blurred layers and viewfinder of a `dof` request. The focus is placed by clicking the picture. */
export function DofFields({ dof, focusHint }: { dof: DofCatalog; focusHint: string }) {
  const defaultIndex = nearestStopIndex(dof.stops, dof.default);
  const viewfinder = dof.viewfinder ?? FALLBACK_DOF.viewfinder!;
  return (
    <>
      <div class="dof-tools" data-dof-tools>
        <span class="repair-region-hint">{focusHint}</span>
        <span class="dof-focus-readout" data-dof-focus-readout></span>
      </div>
      <label class="dof-f-row">
        F 値{' '}
        <input
          type="range"
          name="dof_f_stop"
          min="0"
          max={String(dof.stops.length - 1)}
          step="1"
          value={String(defaultIndex)}
          data-dof-stops={JSON.stringify(dof.stops)}
          data-dof-guide-radius={dof.guideRadiusPerF !== null ? String(dof.guideRadiusPerF) : undefined}
        />{' '}
        <span class="dof-f-readout" data-dof-f-readout>
          f/{dof.stops[defaultIndex]}
        </span>
      </label>
      <fieldset class="dof-scope">
        <legend>ボカす範囲</legend>
        {SCOPE_LAYERS.map(([layer, label]) => (
          <label>
            <input type="checkbox" name={`dof_scope_${layer}`} checked={dof.scope[layer]} /> {label}
          </label>
        ))}
      </fieldset>
      <div class="dof-viewfinder" role="radiogroup" aria-label="ファインダー">
        <span class="dial-label">ファインダー</span>
        {viewfinder.values.map((value) => (
          <label class="wb-radio-pill">
            <input type="radio" name="dof_viewfinder" value={value} checked={value === viewfinder.default} />
            <span>{VIEWFINDER_LABELS[value] ?? value}</span>
          </label>
        ))}
      </div>
    </>
  );
}

/** `Dof` section of a delivered Generation (docs/ui.md「Generation Detail」「Dof」節). */
export function DofSection({ shortId, form }: { shortId: string; form: DofFormData }) {
  if (!form.dof) return null;
  return (
    <details class="section" open>
      <summary>ボケ（Dof）</summary>
      <div class="section-body">
        <form class="option-form dof-form" data-request-kind="dof" data-generation-short-id={shortId} autocomplete="off">
          <DofFields dof={form.dof} focusHint="画像をクリックしてピント位置を置く" />
          <Help text={form.dof.focus ?? 'ピントを置いた位置の奥行きから離れるほどぼかす。F 値が小さいほど強くぼける。納品の層（人物・フチ・背景）ごとにぼかす範囲を選ぶ。ファインダーは三分割グリッドとピント位置の枠を重ねる。両方なら重ねない絵と重ねた絵の 2 枚'} />
          <p class="option-preview"></p>
          <button type="submit">ボケをかける</button>
        </form>
      </div>
    </details>
  );
}
