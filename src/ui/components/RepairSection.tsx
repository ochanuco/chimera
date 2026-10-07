import type { Dials } from '../option-forms';
import { dialWordsFor } from '../option-forms';
import { DenoiseField, DialField, Help } from './OptionControls';

export interface RepairFormData {
  dials: Dials | null;
}

/** Repair form body: hands/feet masked local redraw. Blank fields are omitted so the worker / recipe default applies. */
export function RepairFields({ dials }: RepairFormData) {
  return (
    <>
      <fieldset class="option-group">
        <legend>部位</legend>
        <label>
          <input type="checkbox" name="repair_part" value="hands" checked /> 手（hands）
        </label>
        <label>
          <input type="checkbox" name="repair_part" value="feet" checked /> 足（feet）
        </label>
        <Help text="描き直す部位。範囲を指定しなければ worker がこの部位を自動検出する" />
      </fieldset>

      <fieldset class="option-group">
        <legend>範囲</legend>
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
        <Help text="指定しなければ worker が手足を自動検出する。足裏など検出しにくい場所は範囲を指定する" />
      </fieldset>

      <fieldset class="option-group">
        <legend>描き直しの細かさ</legend>
        <DenoiseField dials={dials} placeholder="recipe default" />
        <Help text="どれだけ元絵から離れるか。空欄なら recipe の既定値、0 より大きく 1 以下" />
        <label>
          seeds{' '}
          <input type="text" name="seeds" inputmode="numeric" placeholder="1, 2, 3, 4" />
        </label>
        <Help text="試す seed をカンマ区切りで（最大 16 件）。空欄なら worker の既定" />
        <label>
          大きさ（size）{' '}
          <input type="number" name="size" step="8" min="256" placeholder="recipe default" />
        </label>
        <Help text="描き直しの長辺（px、8 の倍数）。空欄なら recipe の既定値" />
        <label>
          pad{' '}
          <input type="number" name="pad" step="0.1" min="0.5" max="3" placeholder="worker default" />
        </label>
        <Help text="検出領域の外側のマージン係数（0.5〜3）。空欄なら worker の既定" />
        <DialField
          fieldKey="lora"
          words={dialWordsFor(dials, 'lora')}
          step="0.05"
          min="0"
          max="2"
          label="part LoRA（lora）"
          placeholder="off"
        />
        <Help text="描き直した部位に掛ける part LoRA の重み。既定は off、word または custom の数値で有効にする" />
      </fieldset>

      <p class="option-preview"></p>
      <button type="submit">手足を描き直す</button>
    </>
  );
}

/** `Repair` section (docs/ui.md「Generation Detail」「Repair」節). */
export function RepairSection({ shortId, form, open = false }: { shortId: string; form: RepairFormData; open?: boolean }) {
  return (
    <details class="section" open={open}>
      <summary>手足の描き直し（Repair）</summary>
      <div class="section-body">
        <form class="option-form repair-form" data-request-kind="repair" data-generation-short-id={shortId} autocomplete="off" data-dials={JSON.stringify(form.dials ?? {})}>
          <RepairFields {...form} />
        </form>
      </div>
    </details>
  );
}
