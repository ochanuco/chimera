import type { Dials, DeliverProfileOption } from '../option-forms';
import type { DeliverDefaults, DofCatalog } from '../../lib/catalogs';
import type { RedrawLight } from '../../lib/catalogs';
import { DOF_VIEWFINDER_LABELS, Help, LIGHT_FROM_CHOICES, LIGHT_SCENE_LABELS, TriStateField } from './OptionControls';

export interface BackdropOption {
  name: string;
  label: string;
}

export interface DeliverFormData {
  dials: Dials | null;
  defaults: DeliverDefaults | null;
  dof: DofCatalog | null;
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

function nearestStopIndex(stops: number[], value: number): number {
  let best = 0;
  stops.forEach((s, i) => {
    if (Math.abs(s - value) < Math.abs(stops[best]! - value)) best = i;
  });
  return best;
}

const DOF_HELP =
  '深度推定で人物の中だけを、ピント位置の深度から離れるほどぼかす。F 値が小さいほど強くぼける。切り抜きはぼかす前の絵で取る。背景もぼかすをオンにすると白フチ・紫フチ・影・背景までぼかす（透過納品とは併用できない）。ファインダー表示は三分割グリッド・ピント位置の枠・シャッター速度と F 値のバーを納品画像に重ねる。ON/OFF 2枚なら重ねない絵と重ねた絵を両方納品する。off なら dof を送らない';

const LIGHT_HELP =
  '紫縁の既定は、元の絵の系譜でいちばん近い描き直し（light）の光源の向き、無ければ recipe の既定。立体を選ぶと光の向きで太い側と落ち影が決まる。光源を指定すると納品の光源をこの向きで上書きする';

/** Deliver form body: profile buttons, 仕上げ (repin / recolor / keep legwear), 納品の見た目 (backdrop, light, stroke) and ボケ (dof). */
export function DeliverFields({
  dials,
  defaults,
  dof,
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
  const lightFromDefault =
    catalogStroke && lightFromValues.includes(catalogStroke) ? catalogStroke : light && lightFromValues.includes(light.defaultFrom) ? light.defaultFrom : 'n';

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
        {dialsEnabled ? (
          <TriStateField fieldKey="keep_legwear" label="脚衣を残す（keep legwear）" />
        ) : (
          <label>
            <input type="checkbox" name="keep_legwear" checked={defaults?.keep_legwear === true} /> 脚衣を残す（keep legwear）
          </label>
        )}
        <Help text="切り抜きで脚衣が消えないよう押さえる（強度 0.62）" />
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
          <label class="light-row">
            <span>紫縁</span>
            <select name="stroke_style">
              <option value="auto" selected>
                既定
              </option>
              <option value="dir">立体</option>
              <option value="even">均等</option>
              <option value="none">無し</option>
            </select>
          </label>
          <Help text={LIGHT_HELP} />
        </div>
      </fieldset>

      {dof ? (
        <fieldset class="option-group">
          <legend>ボケ</legend>
          <label>
            <input type="checkbox" name="dof" /> 被写界深度ボケ（dof）
          </label>
          <Help text={DOF_HELP} />
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
              data-dof-guide-radius={dof.guideRadiusPerF !== null ? String(dof.guideRadiusPerF) : undefined}
              disabled
            />{' '}
            <span class="dof-f-readout" data-dof-f-readout>
              f/{dof.stops[dofDefaultIndex]}
            </span>
          </label>
          {dof.guideRadiusPerF !== null ? <span class="repair-region-hint">円はくっきり見える範囲の目安（奥行きは見ていない）</span> : null}
          {dof.scope ? (
            <label>
              <input type="checkbox" name="dof_scope_all" checked={dof.scope.backdrop} disabled /> 背景もぼかす（白フチ・紫フチ・影・背景も）
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
