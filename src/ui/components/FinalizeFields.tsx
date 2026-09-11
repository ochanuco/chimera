import { dialWordsFor, finalizeTakesRecolor, type FinalizeDials, type FinalizeProfileOption } from '../finalize-options';

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
function KeepLegwearField({ dialsEnabled }: { dialsEnabled: boolean }) {
  if (!dialsEnabled) {
    return (
      <label>
        <input type="checkbox" name="keep_legwear" /> keep legwear
      </label>
    );
  }
  return <TriStateField fieldKey="keep_legwear" label="keep legwear" />;
}

/** `repair lora`: a plain number input when no dials/profiles are in play, else always off/on/custom. */
function RepairLoraField({ dialsEnabled }: { dialsEnabled: boolean }) {
  if (!dialsEnabled) {
    return (
      <label>
        repair lora <input type="number" name="repair_lora" step="0.05" placeholder="off" disabled />
      </label>
    );
  }
  return <TriStateField fieldKey="repair_lora" label="repair lora" />;
}

/** `denoise`: a plain number input, or a word segmented-button group when the catalog has words for this recipe. */
function DenoiseField({ dials }: { dials: FinalizeDials | null }) {
  const words = dialWordsFor(dials, 'denoise');
  if (!words) {
    return (
      <label>
        denoise <input type="number" name="denoise" step="0.01" min="0" max="1" placeholder="recipe default" />
      </label>
    );
  }
  return <DialField fieldKey="denoise" words={words} step="0.01" min="0" max="1" label="denoise" placeholder="recipe default" />;
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
  profiles = [],
}: {
  recipe: string | null;
  submitLabel: string;
  dials?: FinalizeDials | null;
  profiles?: FinalizeProfileOption[];
}) {
  const dialsEnabled = (dials !== null && Object.keys(dials).length > 0) || profiles.length > 0;

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
        <legend>仕上げ</legend>
        <label>
          <input type="checkbox" name="repin" /> repin
        </label>
        <span class="finalize-help" tabindex={0} role="note" aria-label="ポーズのピン留めをやり直す" data-help="ポーズのピン留めをやり直す">
          ?
        </span>
        {finalizeTakesRecolor(recipe) ? (
          <>
            <label>
              <input type="checkbox" name="recolor" /> recolor
            </label>
            <span
              class="finalize-help"
              tabindex={0}
              role="note"
              aria-label="yukari のパレットに揃える。recipe が yukari の Batch でだけ出る"
              data-help="yukari のパレットに揃える。recipe が yukari の Batch でだけ出る"
            >
              ?
            </span>
          </>
        ) : null}
        <KeepLegwearField dialsEnabled={dialsEnabled} />
        <span class="finalize-help" tabindex={0} role="note" aria-label="脚衣を残す（強度 0.62）" data-help="脚衣を残す（強度 0.62）">
          ?
        </span>
        <DenoiseField dials={dials} />
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="空欄なら recipe の既定値。0〜1 の範囲"
          data-help="空欄なら recipe の既定値。0〜1 の範囲"
        >
          ?
        </span>
      </fieldset>

      <fieldset class="finalize-group">
        <legend>納品の見た目</legend>
        <label>
          backdrop{' '}
          <select name="backdrop">
            <option value="stripes" selected>
              stripes
            </option>
            <option value="transparent">transparent</option>
            <option value="color">color</option>
          </select>
          <input type="text" name="backdrop_color" placeholder="#RRGGBB" pattern="^#[0-9a-fA-F]{6}$" hidden disabled />
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="背景。stripes が既定、transparent は背景なし、color は #RRGGBB を指定する"
          data-help="背景。stripes が既定、transparent は背景なし、color は #RRGGBB を指定する"
        >
          ?
        </span>
        <label>
          stroke light（影の向き）{' '}
          <select name="stroke_light">
            <option value="none" selected>
              none
            </option>
            <option value="n">↓</option>
            <option value="ne">↙</option>
            <option value="e">←</option>
            <option value="se">↖</option>
            <option value="s">↑</option>
            <option value="sw">↗</option>
            <option value="w">→</option>
            <option value="nw">↘</option>
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
        <legend>部分描き直し</legend>
        <label>
          <input type="checkbox" name="repair_hands" /> repair hands
        </label>
        <label>
          <input type="checkbox" name="repair_feet" /> repair feet
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
          repair pad <input type="number" name="repair_pad" step="0.1" min="0.5" max="3" placeholder="1.0" disabled />
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
