import { finalizeTakesRecolor } from '../finalize-options';

/** Shared body of the Finalize form (GenerationDetail / BatchDetail), rendered inside the caller's own `<form>`. */
export function FinalizeFields({ recipe, submitLabel }: { recipe: string | null; submitLabel: string }) {
  return (
    <>
      <fieldset class="finalize-group">
        <legend>Finish</legend>
        <label>
          <input type="checkbox" name="repin" /> repin
        </label>
        <span class="finalize-hint">re-pin the pose</span>
        {finalizeTakesRecolor(recipe) ? (
          <>
            <label>
              <input type="checkbox" name="recolor" /> recolor
            </label>
            <span class="finalize-hint">assert the yukari palette</span>
          </>
        ) : null}
        <label>
          <input type="checkbox" name="keep_legwear" /> keep legwear
        </label>
        <span class="finalize-hint">keep legwear at 0.62</span>
        <label>
          denoise <input type="number" name="denoise" step="0.01" min="0" max="1" placeholder="recipe default" />
        </label>
        <span class="finalize-hint">blank = recipe default</span>
      </fieldset>

      <fieldset class="finalize-group">
        <legend>Delivery look</legend>
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
        <span class="finalize-hint">stripes (default), transparent, or a solid #RRGGBB</span>
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
        <span class="finalize-hint">where the light sits; the purple stroke goes thin on that side, thick opposite</span>
      </fieldset>

      <fieldset class="finalize-group">
        <legend>Repair</legend>
        <label>
          <input type="checkbox" name="repair_hands" /> repair hands
        </label>
        <label>
          <input type="checkbox" name="repair_feet" /> repair feet
        </label>
        <span class="finalize-hint">mask and redraw just that region, on this same finalize request</span>
        <label>
          repair pad <input type="number" name="repair_pad" step="0.1" min="0.5" max="3" placeholder="1.0" disabled />
        </label>
        <span class="finalize-hint">mask padding 0.5-3.0; blank = worker default</span>
      </fieldset>

      <p class="finalize-preview"></p>
      <button type="submit">{submitLabel}</button>
    </>
  );
}
