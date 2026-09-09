import { finalizeTakesRecolor } from '../finalize-options';

/** Shared body of the Finalize form (GenerationDetail / BatchDetail), rendered inside the caller's own `<form>`. */
export function FinalizeFields({ recipe, submitLabel }: { recipe: string | null; submitLabel: string }) {
  return (
    <>
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
        <label>
          <input type="checkbox" name="keep_legwear" /> keep legwear
        </label>
        <span class="finalize-help" tabindex={0} role="note" aria-label="脚衣を残す（強度 0.62）" data-help="脚衣を残す（強度 0.62）">
          ?
        </span>
        <label>
          denoise <input type="number" name="denoise" step="0.01" min="0" max="1" placeholder="recipe default" />
        </label>
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
          stroke light{' '}
          <select name="stroke_light">
            <option value="none" selected>
              none
            </option>
            <option value="n">n (↑ from top)</option>
            <option value="ne">ne (↗ from top-right)</option>
            <option value="e">e (→ from right)</option>
            <option value="se">se (↘ from bottom-right)</option>
            <option value="s">s (↓ from bottom)</option>
            <option value="sw">sw (↙ from bottom-left)</option>
            <option value="w">w (← from left)</option>
            <option value="nw">nw (↖ from top-left)</option>
          </select>
        </label>
        <span
          class="finalize-help"
          tabindex={0}
          role="note"
          aria-label="光源の位置。紫縁がその側で細く、反対側で太くなる。none なら一定の太さ"
          data-help="光源の位置。紫縁がその側で細く、反対側で太くなる。none なら一定の太さ"
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
      </fieldset>

      <p class="finalize-preview"></p>
      <button type="submit">{submitLabel}</button>
    </>
  );
}
