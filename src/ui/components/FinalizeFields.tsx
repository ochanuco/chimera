import { dialWordsFor, finalizeTakesRecolor, type FinalizeDials, type FinalizeProfileOption } from '../finalize-options';
import type { FinalizeDefaults } from '../../lib/catalogs';

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

/**
 * Shared body of the Finalize form (GenerationDetail / BatchDetail), rendered inside the
 * caller's own `<form>`. `dialsEnabled` gates the UI-level dial/profile treatment (denoise's
 * word buttons still separately require the catalog to carry words — see DenoiseField); when
 * the recipe has neither dials nor profiles, every field renders exactly as it always has.
 */
export function FinalizeFields({
  recipe,
  submitLabel,
  dials = null,
  defaults = null,
  profiles = [],
  backdrops = [],
  recipeRef = null,
  catalogVersion = null,
}: {
  recipe: string | null;
  submitLabel: string;
  dials?: FinalizeDials | null;
  defaults?: FinalizeDefaults | null;
  profiles?: FinalizeProfileOption[];
  /** Catalog top-level `backdrops` (name/label only, no thumbnail bytes — those are fetched via backdropThumbnailUrl). Empty for a catalog published before this key existed, or with no catalog at all. */
  backdrops?: BackdropOption[];
  /** recipe_ref the thumbnail route serves under (defaultRecipeRef(env)); null when there's no catalog to serve from. */
  recipeRef?: string | null;
  /** The published catalog's updated_at — cache-busts the otherwise-immutable thumbnail URL. */
  catalogVersion?: string | null;
}) {
  const dialsEnabled = (dials !== null && Object.keys(dials).length > 0) || profiles.length > 0;

  const strokeLightDirections = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const strokeLightDefault =
    typeof defaults?.stroke_light === 'string' && strokeLightDirections.includes(defaults.stroke_light)
      ? defaults.stroke_light
      : 'none';

  // Pattern choices: the catalog's backdrops when it published any, else the pre-thumbnail
  // fallback of a single unillustrated "stripes" card (fallback behaviour required for a
  // catalog from a worker that predates this key).
  const patternChoices = backdrops.length > 0 ? backdrops : [{ name: 'stripes', label: '斜めストライプ' }];
  const backdropChoiceNames = [...patternChoices.map((b) => b.name), 'transparent', 'color'];
  const rawBackdropDefault = typeof defaults?.backdrop === 'string' ? defaults.backdrop : null;
  const backdropDefault =
    rawBackdropDefault && backdropChoiceNames.includes(rawBackdropDefault) ? rawBackdropDefault : patternChoices[0]!.name;

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
          aria-label="ON: 素のピクセルをそのまま、切り抜き・白枠紫枠・背景・影の向きだけ付けて納品する。yukari-anima は手描き線が素に入っているのでこれが既定。OFF: IL（hassaku）で 2560 に描き直してから納品する。denoise・脚衣・部分描き直しは OFF のときだけ効く"
          data-help="ON: 素のピクセルをそのまま、切り抜き・白枠紫枠・背景・影の向きだけ付けて納品する。yukari-anima は手描き線が素に入っているのでこれが既定。OFF: IL（hassaku）で 2560 に描き直してから納品する。denoise・脚衣・部分描き直しは OFF のときだけ効く"
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
        {finalizeTakesRecolor(recipe) ? (
          <>
            <label>
              <input type="checkbox" name="recolor" checked={defaults?.recolor === true} /> パレットを揃える（recolor）
            </label>
            <span
              class="finalize-help"
              tabindex={0}
              role="note"
              aria-label="yukari のパレットに塗り直す（膝枕パレット断定用）。recipe が yukari の Batch でだけ出る"
              data-help="yukari のパレットに塗り直す（膝枕パレット断定用）。recipe が yukari の Batch でだけ出る"
            >
              ?
            </span>
          </>
        ) : null}
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
        <input type="text" name="backdrop_color" placeholder="#RRGGBB" pattern="^#[0-9a-fA-F]{6}$" hidden disabled />
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
              none（一定の太さ）
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

      <fieldset class="finalize-group">
        <legend>部分描き直し（描き直す時だけ）</legend>
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
          aria-label="その部位だけマスクして描き直す。この finalize request に相乗りする"
          data-help="その部位だけマスクして描き直す。この finalize request に相乗りする"
        >
          ?
        </span>
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
          aria-label="描き直した部位の part LoRA 強度。空欄なら off。repair hands か repair feet のどちらかが必要"
          data-help="描き直した部位の part LoRA 強度。空欄なら off。repair hands か repair feet のどちらかが必要"
        >
          ?
        </span>
      </fieldset>

      <p class="finalize-preview"></p>
      <button type="submit">{submitLabel}</button>
    </>
  );
}
