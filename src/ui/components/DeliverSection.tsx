import type { Dials, DeliverProfileOption } from '../option-forms';
import type { DeliverDefaults, DeliverOutlines } from '../../lib/catalogs';
import type { RedrawLight } from '../../lib/catalogs';
import { Help, LIGHT_FROM_CHOICES, LIGHT_SCENE_LABELS, TriStateField } from './OptionControls';
import { OutlineEditor } from './OutlineEditor';

export interface BackdropOption {
  name: string;
  label: string;
}

export interface DeliverFormData {
  dials: Dials | null;
  defaults: DeliverDefaults | null;
  /** The recipe's `deliver.outlines`: the default outline list and its limits. null falls back to white inside, purple outside. */
  outlines: DeliverOutlines | null;
  /** The recipe's `redraw.light`: the scenes and directions the deliver `light` field offers. */
  light: RedrawLight | null;
  backdropColor: string | null;
  profiles: DeliverProfileOption[];
  /** Catalog top-level `backdrops` (name/label only; thumbnail bytes come from backdropThumbnailUrl). Empty when the catalog predates this key, or there's no catalog. */
  backdrops: BackdropOption[];
  /** recipe_ref the thumbnail route serves under (defaultRecipeRef(env)); null when there's no catalog to serve from. */
  recipeRef: string | null;
  /** The published catalog's updated_at — cache-busts the otherwise-immutable thumbnail URL. */
  catalogVersion: string | null;
}

/** `GET /api/v1/catalogs/{recipe_ref}/backdrops/{name}.png?v=<catalogVersion>` — a stable URL per (recipe, name), busted only when the catalog is republished. */
function backdropThumbnailUrl(recipeRef: string, catalogVersion: string | null, name: string): string {
  const q = catalogVersion ? `?v=${encodeURIComponent(catalogVersion)}` : '';
  return `/api/v1/catalogs/${encodeURIComponent(recipeRef)}/backdrops/${encodeURIComponent(name)}.png${q}`;
}

const LIGHT_HELP =
  '光源を指定すると、納品の光源をこの向きで上書きする。指定しなければ元の絵の系譜でいちばん近い描き直し（light）の光源を引き継ぐ。フチの陰影の向きは「フチ」の欄で選ぶ';

/** Deliver form body: profile buttons, 仕上げ (repin / recolor / skin / keep legwear / keep scene) and 納品の見た目 (backdrop, light, outlines). */
export function DeliverFields({
  dials,
  defaults,
  outlines,
  light,
  backdropColor,
  profiles,
  backdrops,
  recipeRef,
  catalogVersion,
}: DeliverFormData) {
  const dialsEnabled = (dials !== null && Object.keys(dials).length > 0) || profiles.length > 0;

  const lightFromValues = LIGHT_FROM_CHOICES.map(([value]) => value);
  const catalogStroke = typeof defaults?.stroke_light === 'string' ? defaults.stroke_light : null;
  const strokeDefault = catalogStroke && (catalogStroke === 'even' || lightFromValues.includes(catalogStroke)) ? catalogStroke : 'even';
  const lightFromDefault = light && lightFromValues.includes(light.defaultFrom) ? light.defaultFrom : 'n';

  // Pattern choices: catalog backdrops when published, else the pre-thumbnail fallback of a single
  // unillustrated "stripes" card (needed for a catalog from a worker that predates this key).
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

      <fieldset class="option-group">
        <legend>仕上げ</legend>
        <label>
          <input type="checkbox" name="repin" checked={defaults?.repin === true} /> 彩度を圧縮する（repin）
        </label>
        <Help text="アクセント色の彩度を基準絵の帯域へ圧縮する後処理。膝枕パレット向けで、紫が灰色に寄るので Anima の素では OFF" />
        <label>
          <input type="checkbox" name="recolor" checked={defaults?.recolor === true} /> パレットを揃える（recolor）
        </label>
        <Help text="yukari のパレットに塗り直す（膝枕パレット断定用）" />
        <label>
          <input type="checkbox" name="skin" checked={defaults?.skin === true} /> 肌を整える（skin）
        </label>
        <Help text="肌の色を揃える後処理" />
        {dialsEnabled ? (
          <TriStateField fieldKey="keep_legwear" label="脚衣を残す（keep legwear）" />
        ) : (
          <label>
            <input type="checkbox" name="keep_legwear" checked={defaults?.keep_legwear === true} /> 脚衣を残す（keep legwear）
          </label>
        )}
        <Help text="切り抜きで脚衣が消えないよう押さえる（強度 0.62）" />
        <label>
          <input type="checkbox" name="keep_scene" checked={defaults?.keep_scene === true} /> 元の場面を残す（keep scene）
        </label>
        <Help text="背景を差し替えず、元の場面をそのまま背景にする" />
      </fieldset>

      <fieldset class="option-group">
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
        <Help text="切り抜いた人物の後ろに敷く模様。透過 PNG は背景なし、単色は指定色で塗る" />
        <div class="light-grid">
          {light ? (
            <label class="light-row">
              <span>光源</span>
              <select name="light_scene">
                <option value="" selected>
                  指定しない（引き継ぎ）
                </option>
                {light.scenes.map((s) => (
                  <option value={s}>{LIGHT_SCENE_LABELS[s] ?? s}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label class="light-row">
            <span>光の向き</span>
            <select name="light_from" disabled>
              {LIGHT_FROM_CHOICES.map(([value, label]) => (
                <option value={value} selected={value === lightFromDefault}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Help text={LIGHT_HELP} />
        </div>
      </fieldset>

      <fieldset class="option-group">
        <legend>フチ</legend>
        <OutlineEditor outlines={outlines} stroke={strokeDefault} />
      </fieldset>

      <p class="option-preview"></p>
      <button type="submit">納品する</button>
    </>
  );
}

/** `Deliver` section (docs/ui.md「Generation Detail」「Deliver」節). Re-delivering reuses the cut assets, so only the finishing options change. */
export function DeliverSection({ shortId, form, open = true }: { shortId: string; form: DeliverFormData; open?: boolean }) {
  return (
    <details class="section" open={open}>
      <summary>納品（Deliver）</summary>
      <div class="section-body">
        <form class="option-form deliver-form" data-request-kind="deliver" data-generation-short-id={shortId} autocomplete="off" data-dials={JSON.stringify(form.dials ?? {})}>
          <DeliverFields {...form} />
        </form>
      </div>
    </details>
  );
}
