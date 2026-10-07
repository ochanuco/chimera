import type { Dials } from '../option-forms';
import type { RedrawDefaults, RedrawLight } from '../../lib/catalogs';
import { DenoiseField, Help, LIGHT_FROM_CHOICES, LIGHT_SCENE_LABELS } from './OptionControls';

export interface RedrawFormData {
  dials: Dials | null;
  defaults: RedrawDefaults | null;
  light: RedrawLight | null;
  /** hires re-renders the stored graph of an Anima generate output; for any other source the method is disabled. */
  hiresAvailable: boolean;
}

function numberDefault(fields: Record<string, unknown> | undefined, key: string): number | null {
  const value = fields?.[key];
  return typeof value === 'number' ? value : null;
}

/** Redraw form body: one method (canvas / hires / light) per request, each with its own fields. */
export function RedrawFields({ dials, defaults, light, hiresAvailable }: RedrawFormData) {
  const canvas = defaults?.canvas;
  const hires = defaults?.hires;
  const canvasDenoise = numberDefault(canvas, 'denoise');
  const canvasSize = numberDefault(canvas, 'size');
  const canvasRoute = canvas?.route === 'latent' || canvas?.route === 'pixel' ? canvas.route : null;
  const hiresDenoise = numberDefault(hires, 'hires_denoise');
  const scenes = light ? light.scenes : Object.keys(LIGHT_SCENE_LABELS);
  const lightFromDefault = light ? light.defaultFrom : 'nw';

  return (
    <>
      <fieldset class="option-group">
        <legend>方法（1 回の request で 1 つ）</legend>
        <label>
          <input type="radio" name="redraw_method" value="canvas" checked /> canvas（全体を描き直す）
        </label>
        <label>
          <input type="radio" name="redraw_method" value="hires" disabled={!hiresAvailable} /> hires（同じ seed で大きく描き直す）
        </label>
        <label>
          <input type="radio" name="redraw_method" value="light" /> light（光を入れ直す）
        </label>
        <Help text="描き直しは Anima で描いた絵だけ。納品済みの絵には使えない。hires は generate の出力だけ（repair / masked redraw / redraw の出力や graph の無い絵は不可）。複数の操作は redraw を重ねる" />
      </fieldset>

      <fieldset class="option-group" data-redraw-panel="canvas">
        <legend>canvas</legend>
        <DenoiseField dials={dials} placeholder={canvasDenoise !== null ? String(canvasDenoise) : 'recipe default'} />
        <Help text="どれだけ元絵から離れるか。空欄なら recipe の既定値、0〜1" />
        <label>
          大きさ（size）{' '}
          <input type="number" name="size" step="1" min="256" placeholder={canvasSize !== null ? String(canvasSize) : 'recipe default'} />
        </label>
        <Help text="描き直しの長辺（px）。空欄なら recipe の既定値" />
        <label>
          route{' '}
          <select name="route">
            <option value="" selected={canvasRoute === null}>
              既定
            </option>
            <option value="latent" selected={canvasRoute === 'latent'}>
              latent
            </option>
            <option value="pixel" selected={canvasRoute === 'pixel'}>
              pixel
            </option>
          </select>
        </label>
        <div class="repair-region-tools" data-repair-region-tools>
          <button type="button" class="repair-region-toggle" data-repair-region-toggle aria-pressed="false">
            範囲指定 OFF
          </button>
          <span class="repair-region-hint">画像をドラッグして元絵に近いまま残す範囲を指定（複数可）</span>
          <span class="repair-region-count" data-repair-region-count></span>
          <button type="button" class="repair-region-clear" data-repair-region-clear>
            範囲をすべて消す
          </button>
        </div>
        <label>
          残す強さ（keep strength）{' '}
          <input type="number" name="keep_strength" step="0.05" min="0.05" max="0.95" placeholder="0.25" />
        </label>
        <Help text="範囲指定した場所で、描き直しがどれだけ触るか。0 より大きく 1 より小さい値。範囲を指定したときだけ送る" />
      </fieldset>

      <fieldset class="option-group" data-redraw-panel="hires" hidden>
        <legend>hires</legend>
        <label>
          長辺（hires）{' '}
          <select name="hires">
            <option value="2048" selected>
              2048
            </option>
            <option value="2560">2560</option>
            <option value="3072">3072</option>
          </select>
        </label>
        <label>
          denoise{' '}
          <input type="number" name="hires_denoise" step="0.05" min="0.05" max="1" placeholder={hiresDenoise !== null ? String(hiresDenoise) : '0.45'} />
        </label>
        <Help text="元の graph に latent upscale と同じ seed の pass を足して描き直す。大きさは標準 canvas の画素数に合わせ、縦長は 2048 で 1280x2048。denoise は 0.45 で線まで描き直し、0.35 で構図を保つ" />
      </fieldset>

      <fieldset class="option-group" data-redraw-panel="light" hidden>
        <legend>light</legend>
        <label>
          光源{' '}
          <select name="light_scene">
            {scenes.map((s) => (
              <option value={s}>{LIGHT_SCENE_LABELS[s] ?? s}</option>
            ))}
          </select>
        </label>
        <label>
          光の向き{' '}
          <select name="light_from">
            {LIGHT_FROM_CHOICES.map(([value, label]) => (
              <option value={value} selected={value === lightFromDefault}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Help text="描いた絵に光を入れ直す。納品で光源を指定しなければ、この光源が引き継がれて紫縁の向きも揃う" />
      </fieldset>

      <p class="option-preview"></p>
      <button type="submit">描き直す</button>
    </>
  );
}

/** `Redraw` section (docs/ui.md「Generation Detail」「Redraw」節). */
export function RedrawSection({ shortId, form, open = true }: { shortId: string; form: RedrawFormData; open?: boolean }) {
  return (
    <details class="section" open={open}>
      <summary>描き直し（Redraw）</summary>
      <div class="section-body">
        <form class="option-form redraw-form" data-request-kind="redraw" data-generation-short-id={shortId} autocomplete="off" data-dials={JSON.stringify(form.dials ?? {})}>
          <RedrawFields {...form} />
        </form>
      </div>
    </details>
  );
}
