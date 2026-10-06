import { dialWordsFor, type FinalizeDials, type FinalizeProfileOption } from '../finalize-options';
import type { FinalizeDefaults, FinalizeDof, FinalizeLight } from '../../lib/catalogs';

export interface BackdropOption {
  name: string;
  label: string;
}

/** `GET /api/v1/catalogs/{recipe_ref}/backdrops/{name}.png?v=<catalogVersion>` — a stable URL per (recipe, name), busted only when the catalog is republished. */
function backdropThumbnailUrl(recipeRef: string, catalogVersion: string | null, name: string): string {
  const q = catalogVersion ? `?v=${encodeURIComponent(catalogVersion)}` : '';
  return `/api/v1/catalogs/${encodeURIComponent(recipeRef)}/backdrops/${encodeURIComponent(name)}.png${q}`;
}

/** A word-dial control: 既定 (default) + one button per catalog word + custom, or a plain number input when the catalog has no words for `fieldKey`. */
function DialField({
  fieldKey,
  words,
  step,
  min,
  max,
  label,
  placeholder,
}: {
  fieldKey: string;
  words: Record<string, number> | null;
  step: string;
  min: string;
  max: string;
  label: string;
  placeholder: string;
}) {
  if (!words) {
    return (
      <label>
        {label} <input type="number" name={fieldKey} step={step} min={min} max={max} placeholder={placeholder} />
      </label>
    );
  }
  return (
    <div class="dial-group" data-dial-key={fieldKey} data-dial-mode="default">
      <span class="dial-label">{label}</span>
      <button type="button" class="dial-btn dial-btn-active" data-dial-value="">
        既定
      </button>
      {Object.entries(words).map(([word, value]) => (
        <button type="button" class="dial-btn" data-dial-value={word}>
          {word} ({value})
        </button>
      ))}
      <button type="button" class="dial-btn dial-btn-custom" data-dial-value="__custom__">
        custom
      </button>
      <input type="number" name={fieldKey} step={step} min={min} max={max} class="dial-custom-input" hidden disabled />
    </div>
  );
}

/** A tri-state (off / on / custom) control — intrinsic to the schema, so it's always tri-state once dials/profiles are in play. */
function TriStateField({ fieldKey, label }: { fieldKey: string; label: string }) {
  return (
    <div class="dial-group dial-group-tristate" data-dial-key={fieldKey} data-dial-mode="off">
      <span class="dial-label">{label}</span>
      <button type="button" class="dial-btn dial-btn-active" data-dial-value="">
        off
      </button>
      <button type="button" class="dial-btn" data-dial-value="on">
        on
      </button>
      <button type="button" class="dial-btn dial-btn-custom" data-dial-value="__custom__">
        custom
      </button>
      <input type="number" name={fieldKey} step="0.05" class="dial-custom-input" hidden disabled />
    </div>
  );
}

/** `keep legwear`: a plain checkbox when no dials/profiles are in play for this recipe, else always off/on/custom (dials/profiles don't gate the tri-state shape — see module doc). */
function KeepLegwearField({ dialsEnabled, defaults }: { dialsEnabled: boolean; defaults: FinalizeDefaults | null }) {
  if (!dialsEnabled) {
    return (
      <label>
        <input type="checkbox" name="keep_legwear" checked={defaults?.keep_legwear === true} /> 脚衣を残す（keep legwear）
      </label>
    );
  }
  return <TriStateField fieldKey="keep_legwear" label="脚衣を残す（keep legwear）" />;
}

/** `repair lora`: a plain number input when no dials/profiles are in play, else always off/on/custom. */
function RepairLoraField({ dialsEnabled }: { dialsEnabled: boolean }) {
  if (!dialsEnabled) {
    return (
      <label>
        部位 LoRA の強さ（repair lora）{' '}
        <input type="number" name="repair_lora" step="0.05" placeholder="off" disabled />
      </label>
    );
  }
  return <TriStateField fieldKey="repair_lora" label="部位 LoRA の強さ（repair lora）" />;
}

/** `denoise`: a plain number input, or a word segmented-button group when the catalog has words for this recipe. */
function DenoiseField({ dials }: { dials: FinalizeDials | null }) {
  const words = dialWordsFor(dials, 'denoise');
  if (!words) {
    return (
      <label>
        描き直しの強さ（denoise）{' '}
        <input type="number" name="denoise" step="0.01" min="0" max="1" placeholder="recipe default" />
      </label>
    );
  }
  return (
    <DialField
      fieldKey="denoise"
      words={words}
      step="0.01"
      min="0"
      max="1"
      label="描き直しの強さ（denoise）"
      placeholder="recipe default"
    />
  );
}

function nearestStopIndex(stops: number[], value: number): number {
  let best = 0;
  stops.forEach((s, i) => {
    if (Math.abs(s - value) < Math.abs(stops[best]! - value)) best = i;
  });
  return best;
}

const DOF_HELP =
  '深度推定で人物の中だけを、ピント位置の深度から離れるほどぼかす。F 値が小さいほど強くぼける。切り抜きはぼかす前の絵で取る。背景もぼかすをオンにすると白フチ・紫フチ・影・背景までぼかす（透過納品とは併用できない）。ファインダー表示は三分割グリッド・ピント位置の枠・シャッター速度と F 値のバーを納品画像に重ねる。ON/OFF 2枚なら重ねない絵と重ねた絵を両方納品する。off なら dof を送らない。部分描き直しとは併用できない';

const LIGHT_HELP =
  '納品画像を夕日や月明かりの場面として、光の向きに合わせて描き直す。光源はどちらから光が来るか。描き直さない（deliver only）のときだけ使え、部分描き直しとは併用できない。紫縁の光源方向は光源に合わせて決まるので、紫縁の光源は送らない。なしなら light を送らない';

const LIGHT_SCENE_LABELS: Record<string, string> = { sunset: '夕日', moon: '月明かり' };

const LIGHT_FROM_LABELS: Record<string, string> = { n: '上', ne: '右上', e: '右', se: '右下', s: '下', sw: '左下', w: '左', nw: '左上' };

const DOF_VIEWFINDER_LABELS: Record<string, string> = { off: 'OFF', on: 'ON', both: 'ON/OFF 2枚' };

/** Shared body of the Finalize form (GenerationDetail), rendered inside the caller's own `<form>`.
 * `dialsEnabled` gates the UI-level dial/profile treatment (denoise's word buttons still separately require catalog words — see DenoiseField). */
export function FinalizeFields({
  submitLabel,
  dials = null,
  defaults = null,
  dof = null,
  light = null,
  backdropColor = null,
  profiles = [],
  backdrops = [],
  recipeRef = null,
  catalogVersion = null,
  regionDrawing = false,
}: {
  submitLabel: string;
  dials?: FinalizeDials | null;
  defaults?: FinalizeDefaults | null;
  /** Catalog `finalize.dof.f_number`; the bokeh controls render only with this and `regionDrawing` (the focus point is placed on the image). */
  dof?: FinalizeDof | null;
  /** Catalog `finalize.light`; the 光源 block renders only with this. */
  light?: FinalizeLight | null;
  /** Catalog `finalize.backdrop_color` (already validated as #RRGGBB); the solid-colour input starts from it, else #ffffff. */
  backdropColor?: string | null;
  profiles?: FinalizeProfileOption[];
  /** Catalog top-level `backdrops` (name/label only; thumbnail bytes come from backdropThumbnailUrl). Empty when the catalog predates this key, or there's no catalog. */
  backdrops?: BackdropOption[];
  /** recipe_ref the thumbnail route serves under (defaultRecipeRef(env)); null when there's no catalog to serve from. */
  recipeRef?: string | null;
  /** The published catalog's updated_at — cache-busts the otherwise-immutable thumbnail URL. */
  catalogVersion?: string | null;
  /** True only where this form sits beside a single Generation's image (Generation Detail). */
  regionDrawing?: boolean;
}) {
  const dialsEnabled = (dials !== null && Object.keys(dials).length > 0) || profiles.length > 0;

  const strokeLightValues = ['none', 'even', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const strokeLightDefault =
    typeof defaults?.stroke_light === 'string' && strokeLightValues.includes(defaults.stroke_light)
      ? defaults.stroke_light
      : 'even';

  // Pattern choices: catalog backdrops when published, else the pre-thumbnail fallback of a single
  // unillustrated "stripes" card (needed for a catalog from a worker that predates this key).
  const patternChoices = backdrops.length > 0 ? backdrops : [{ name: 'stripes', label: '斜めストライプ' }];
  const backdropChoiceNames = [...patternChoices.map((b) => b.name), 'transparent', 'color'];
  const rawBackdropDefault = typeof defaults?.backdrop === 'string' ? defaults.backdrop : null;
  const backdropDefault =
    rawBackdropDefault && backdropChoiceNames.includes(rawBackdropDefault) ? rawBackdropDefault : patternChoices[0]!.name;

  const dofDefaultIndex = dof ? nearestStopIndex(dof.stops, dof.default) : 0;

  return (
    <>
      {profiles.length > 0 ? (
        <div class="profile-group" data-profile-group>
          <span class="dial-label">profile</span>
          <button type="button" class="dial-btn dial-btn-active profile-btn-custom">
            custom
          </button>
          {profiles.map((p) => (
            <button
              type="button"
              class="dial-btn profile-btn"
              data-profile-name={p.name}
              data-profile-version={String(p.version)}
              data-profile-options={JSON.stringify(p.options)}
            >
              {p.name} v{p.version}
            </button>
          ))}
          <input type="hidden" name="profile_name" value="" />
          <input type="hidden" name="profile_version" value="" />
        </div>
      ) : null}

      <fieldset class="finalize-group">
        <legend>描き直し</legend>
        <label>
          <input type="checkbox" name="deliver_only" checked={defaults?.deliver_only === true} /> 描き直さない（素の絵をそのまま切り抜いて納品）
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="ON: 素のピクセルをそのまま、切り抜き・白枠紫枠・背景・影の向きだけ付けて納品する。全 recipe でこれが既定。OFF: IL（hassaku）で 2560 に描き直してから納品する。描き直しができるのは Anima（recipe yukari）で描いた絵だけで、それ以外の絵は OFF にすると worker が拒否する。denoise・脚衣は OFF のときだけ効く。部分描き直しは ON/OFF どちらでも使え、ON では候補数（repair seeds）分の納品候補を作る"
          data-help="ON: 素のピクセルをそのまま、切り抜き・白枠紫枠・背景・影の向きだけ付けて納品する。全 recipe でこれが既定。OFF: IL（hassaku）で 2560 に描き直してから納品する。描き直しができるのは Anima（recipe yukari）で描いた絵だけで、それ以外の絵は OFF にすると worker が拒否する。denoise・脚衣は OFF のときだけ効く。部分描き直しは ON/OFF どちらでも使え、ON では候補数（repair seeds）分の納品候補を作る"
        >
          ?
        </span>
        <label>
          <input type="checkbox" name="repin" checked={defaults?.repin === true} /> 彩度を圧縮する（repin）
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="アクセント色の彩度を基準絵の帯域へ圧縮する後処理。膝枕パレット向けで、紫が灰色に寄るので Anima の素では OFF"
          data-help="アクセント色の彩度を基準絵の帯域へ圧縮する後処理。膝枕パレット向けで、紫が灰色に寄るので Anima の素では OFF"
        >
          ?
        </span>
        <label>
          <input type="checkbox" name="recolor" checked={defaults?.recolor === true} /> パレットを揃える（recolor）
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="yukari のパレットに塗り直す（膝枕パレット断定用）"
          data-help="yukari のパレットに塗り直す（膝枕パレット断定用）"
        >
          ?
        </span>
        <KeepLegwearField dialsEnabled={dialsEnabled} defaults={defaults} />
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="描き直しで脚衣が消えないよう押さえる（強度 0.62）。描き直さない時は効かない"
          data-help="描き直しで脚衣が消えないよう押さえる（強度 0.62）。描き直さない時は効かない"
        >
          ?
        </span>
        <DenoiseField dials={dials} />
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="描き直しでどれだけ元絵から離れるか。空欄なら recipe の既定値、0〜1。描き直さない時は効かない"
          data-help="描き直しでどれだけ元絵から離れるか。空欄なら recipe の既定値、0〜1。描き直さない時は効かない"
        >
          ?
        </span>
        <label>
          hires 刷り直し{' '}
          <select name="hires">
            <option value="off" selected>
              off
            </option>
            <option value="2048-0.45">2048 · denoise 0.45 線まで描き直す</option>
            <option value="2048-0.35">2048 · denoise 0.35 構図を保つ</option>
          </select>
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="元の graph に latent upscale と同じ seed の pass を足して描き直し、以降の設定はその絵に掛かる。canvas は直接変えない。大きさは標準 canvas の画素数に合わせ、縦長は 1280x2048、正方形は約 1616 四方。deliver only 中だけ使え、repair とは併用できない。Anima の絵だけ"
          data-help="元の graph に latent upscale と同じ seed の pass を足して描き直し、以降の設定はその絵に掛かる。canvas は直接変えない。大きさは標準 canvas の画素数に合わせ、縦長は 1280x2048、正方形は約 1616 四方。deliver only 中だけ使え、repair とは併用できない。Anima の絵だけ"
        >
          ?
        </span>
      </fieldset>

      <fieldset class="finalize-group">
        <legend>納品の見た目</legend>
        <div class="backdrop-picker" data-backdrop-group>
          <span class="dial-label">背景（backdrop）</span>
          {patternChoices.map((bd) => (
            <label class="backdrop-option" data-backdrop-value={bd.name}>
              <input type="radio" name="backdrop" value={bd.name} checked={backdropDefault === bd.name} />
              {backdrops.length > 0 && recipeRef ? (
                <img
                  class="backdrop-thumb"
                  src={backdropThumbnailUrl(recipeRef, catalogVersion, bd.name)}
                  alt={bd.label}
                  width="60"
                  height="96"
                  loading="lazy"
                />
              ) : null}
              <span class="backdrop-option-label">{bd.label}</span>
            </label>
          ))}
          <label class="backdrop-option backdrop-option-plain" data-backdrop-value="transparent">
            <input type="radio" name="backdrop" value="transparent" checked={backdropDefault === 'transparent'} />
            <span class="backdrop-option-label">透過 PNG</span>
          </label>
          <label class="backdrop-option backdrop-option-plain" data-backdrop-value="color">
            <input type="radio" name="backdrop" value="color" checked={backdropDefault === 'color'} />
            <span class="backdrop-option-label">単色</span>
          </label>
        </div>
        <input type="text" name="backdrop_color" placeholder="#RRGGBB" pattern="^#[0-9a-fA-F]{6}$" value={backdropColor ?? '#ffffff'} hidden disabled />
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="切り抜いた人物の後ろに敷く模様。透過 PNG は背景なし、単色は指定色で塗る"
          data-help="切り抜いた人物の後ろに敷く模様。透過 PNG は背景なし、単色は指定色で塗る"
        >
          ?
        </span>
        <label>
          縁の影の向き（stroke light）{' '}
          <select name="stroke_light">
            <option value="none" selected={strokeLightDefault === 'none'}>
              none（縁無し）
            </option>
            <option value="even" selected={strokeLightDefault === 'even'}>
              even（一定の太さ）
            </option>
            <option value="n" selected={strokeLightDefault === 'n'}>
              ↓
            </option>
            <option value="ne" selected={strokeLightDefault === 'ne'}>
              ↙
            </option>
            <option value="e" selected={strokeLightDefault === 'e'}>
              ←
            </option>
            <option value="se" selected={strokeLightDefault === 'se'}>
              ↖
            </option>
            <option value="s" selected={strokeLightDefault === 's'}>
              ↑
            </option>
            <option value="sw" selected={strokeLightDefault === 'sw'}>
              ↗
            </option>
            <option value="w" selected={strokeLightDefault === 'w'}>
              →
            </option>
            <option value="nw" selected={strokeLightDefault === 'nw'}>
              ↘
            </option>
          </select>
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="矢印は影が伸びる向き。紫縁はその側が太く、反対の光源側が細くなる。none なら一定の太さ"
          data-help="矢印は影が伸びる向き。紫縁はその側が太く、反対の光源側が細くなる。none なら一定の太さ"
        >
          ?
        </span>
      </fieldset>

      {dof && regionDrawing ? (
        <fieldset class="finalize-group">
          <legend>ボケ</legend>
          <label>
            <input type="checkbox" name="dof" /> 被写界深度ボケ（dof）
          </label>
          <span class="finalize-help" tabindex={0} role="note" aria-label={DOF_HELP} data-help={DOF_HELP}>
            ?
          </span>
          <div class="dof-tools" data-dof-tools>
            <span class="repair-region-hint">画像をクリックしてピント位置を置く</span>
            <span class="dof-focus-readout" data-dof-focus-readout></span>
          </div>
          <label class="dof-f-row">
            F値{' '}
            <input
              type="range"
              name="dof_f_stop"
              min="0"
              max={String(dof.stops.length - 1)}
              step="1"
              value={String(dofDefaultIndex)}
              data-dof-stops={JSON.stringify(dof.stops)}
              disabled
            />{' '}
            <span class="dof-f-readout" data-dof-f-readout>
              f/{dof.stops[dofDefaultIndex]}
            </span>
          </label>
          {dof.scope ? (
            <label>
              <input type="checkbox" name="dof_scope_all" checked={dof.scope.default === 'all'} disabled /> 背景もぼかす（白フチ・紫フチ・影・背景も）
            </label>
          ) : null}
          {dof.viewfinder ? (
            <label>
              ファインダー表示{' '}
              <select name="dof_viewfinder" disabled>
                {dof.viewfinder.values.map((v) => (
                  <option value={v} selected={v === dof.viewfinder!.default}>
                    {DOF_VIEWFINDER_LABELS[v] ?? v}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {light ? (
        <fieldset class="finalize-group">
          <legend>光源</legend>
          <label>
            場面{' '}
            <select name="light_scene">
              <option value="" selected>
                なし
              </option>
              {light.scenes.map((s) => (
                <option value={s}>{LIGHT_SCENE_LABELS[s] ?? s}</option>
              ))}
            </select>
          </label>
          <label>
            光源{' '}
            <select name="light_from" disabled>
              {light.from.map((d) => (
                <option value={d} selected={d === light.defaultFrom}>
                  {LIGHT_FROM_LABELS[d] ?? d}
                </option>
              ))}
            </select>
          </label>
          <span class="finalize-help" tabindex={0} role="note" aria-label={LIGHT_HELP} data-help={LIGHT_HELP}>
            ?
          </span>
        </fieldset>
      ) : null}

      <fieldset class="finalize-group">
        <legend>部分描き直し</legend>
        <label>
          <input type="checkbox" name="repair_hands" /> 手を描き直す（repair hands）
        </label>
        <label>
          <input type="checkbox" name="repair_feet" /> 足を描き直す（repair feet）
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="その部位だけマスクして描き直す。この finalize request に相乗りする。描き直さない（deliver only）でも使え、その場合は候補数分の納品候補を作る"
          data-help="その部位だけマスクして描き直す。この finalize request に相乗りする。描き直さない（deliver only）でも使え、その場合は候補数分の納品候補を作る"
        >
          ?
        </span>
        {regionDrawing ? (
          <div class="repair-region-tools" data-repair-region-tools>
            <button type="button" class="repair-region-toggle" data-repair-region-toggle aria-pressed="false">
              範囲指定 OFF
            </button>
            <span class="repair-region-hint">画像をドラッグして描き直す範囲を指定（複数可）</span>
            <span class="repair-region-count" data-repair-region-count></span>
            <button type="button" class="repair-region-clear" data-repair-region-clear>
              範囲をすべて消す
            </button>
          </div>
        ) : null}
        <label>
          マスクの余白（repair pad）{' '}
          <input type="number" name="repair_pad" step="0.1" min="0.5" max="3" placeholder="1.0" disabled />
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="マスクの余白 0.5〜3.0。空欄なら worker の既定値。repair hands か repair feet のどちらかが必要"
          data-help="マスクの余白 0.5〜3.0。空欄なら worker の既定値。repair hands か repair feet のどちらかが必要"
        >
          ?
        </span>
        <RepairLoraField dialsEnabled={dialsEnabled} />
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="描き直した部位の part LoRA 強度。空欄なら off。repair hands か repair feet のどちらかが必要。描き直さない（deliver only）で Anima（recipe yukari）由来の絵に使うときは worker が無視する（描き直しと組み合わせるとき、または Anima 以外の絵を deliver only するときは効く）"
          data-help="描き直した部位の part LoRA 強度。空欄なら off。repair hands か repair feet のどちらかが必要。描き直さない（deliver only）で Anima（recipe yukari）由来の絵に使うときは worker が無視する（描き直しと組み合わせるとき、または Anima 以外の絵を deliver only するときは効く）"
        >
          ?
        </span>
        <label>
          候補数（repair seeds）{' '}
          <input type="number" name="repair_seeds" step="1" min="1" max="8" placeholder="4" disabled />
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="描き直さない（deliver only）で部分描き直しと組み合わせた時だけ効く。seed ごとに1候補、1〜8、空欄なら worker 既定 4"
          data-help="描き直さない（deliver only）で部分描き直しと組み合わせた時だけ効く。seed ごとに1候補、1〜8、空欄なら worker 既定 4"
        >
          ?
        </span>
      </fieldset>

      <p class="finalize-preview"></p>
      <button type="submit">{submitLabel}</button>
    </>
  );
}
