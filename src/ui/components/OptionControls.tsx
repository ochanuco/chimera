import { dialWordsFor, type Dials } from '../option-forms';

/** A "?" bubble; the text is shown on hover/focus through `data-help`. */
export function Help({ text }: { text: string }) {
  return (
    <span class="option-help" tabindex={0} role="note" aria-label={text} data-help={text}>
      ?
    </span>
  );
}

/** A word-dial control: 既定 (default) + one button per catalog word + custom, or a plain number input when the catalog has no words for `fieldKey`. */
export function DialField({
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
export function TriStateField({ fieldKey, label }: { fieldKey: string; label: string }) {
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

/** `denoise`: a plain number input, or a word segmented-button group when the catalog has words for this recipe. */
export function DenoiseField({ dials, placeholder }: { dials: Dials | null; placeholder: string }) {
  return (
    <DialField
      fieldKey="denoise"
      words={dialWordsFor(dials, 'denoise')}
      step="0.01"
      min="0"
      max="1"
      label="描き直しの強さ（denoise）"
      placeholder={placeholder}
    />
  );
}

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
