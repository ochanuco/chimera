import { Layout } from '../layout';
import type { WorkbenchPicks } from '../../schemas/workbenches';
import type { WorkbenchTree } from '../../lib/workbench';
import type { DeliverDefaults, DeliverOutlines, DofCatalog, RedrawDefaults, RedrawLight } from '../../lib/catalogs';
import type { Dials } from '../option-forms';
import { dialWordsFor } from '../option-forms';
import { Compass, OutlineEditor } from '../components/OutlineEditor';
import { DofFields, FALLBACK_DOF } from '../components/DofFields';
import { LIGHT_SCENE_LABELS } from '../components/OptionControls';
import { CapActions } from '../components/CapActions';
import { PHOTO_MAX_SIDE, type PhotoItem } from '../../lib/photos';

export interface BackdropOption {
  name: string;
  label: string;
}

export interface WorkbenchData {
  root: { id: string; short_id: string };
  tree: WorkbenchTree;
  picks: WorkbenchPicks;
  /** Short id from `?at=`: the Generation to preselect. */
  at: string | null;
  redrawDefaults: RedrawDefaults | null;
  redrawDials: Dials | null;
  light: RedrawLight | null;
  deliverDefaults: DeliverDefaults | null;
  outlines: DeliverOutlines | null;
  strokeDefault: string;
  backdrops: BackdropOption[];
  recipeRef: string | null;
  catalogVersion: string | null;
  backdropColor: string | null;
  dof: DofCatalog | null;
  /** Photos uploaded on `/photos` (or from the 背景 phase), newest first. */
  photos: PhotoItem[];
}

const PHASES = [
  { no: 1, label: '描き直し' },
  { no: 2, label: 'フチ' },
  { no: 3, label: '背景' },
  { no: 4, label: '光' },
  { no: 5, label: 'ボケ' },
] as const;

function numberDefault(fields: Record<string, unknown> | undefined, key: string): number | null {
  const value = fields?.[key];
  return typeof value === 'number' ? value : null;
}

function withValue(options: number[], value: number | null): number[] {
  return value !== null && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options;
}

export function backdropThumbnailUrl(recipeRef: string, catalogVersion: string | null, name: string): string {
  const q = catalogVersion ? `?v=${encodeURIComponent(catalogVersion)}` : '';
  return `/api/v1/catalogs/${encodeURIComponent(recipeRef)}/backdrops/${encodeURIComponent(name)}.png${q}`;
}

function DenoiseWords({ dials }: { dials: Dials | null }) {
  const words = dialWordsFor(dials, 'denoise');
  if (!words) return null;
  return (
    <div class="wb-words" data-wb-denoise-words>
      {Object.entries(words).map(([word, value]) => (
        <button type="button" class="wb-pill" data-wb-denoise-word={String(value)}>
          {word} <span class="mono">{value}</span>
        </button>
      ))}
    </div>
  );
}

function RedrawForm({ data }: { data: WorkbenchData }) {
  const canvas = data.redrawDefaults?.canvas;
  const hires = data.redrawDefaults?.hires;
  const canvasDenoise = numberDefault(canvas, 'denoise') ?? 0.4;
  const canvasSize = numberDefault(canvas, 'size') ?? 2560;
  const hiresDenoise = numberDefault(hires, 'hires_denoise') ?? 0.45;
  const sizes = withValue([2048, 2560], canvasSize);
  const hiresDenoises = withValue([0.35, 0.45, 0.55], hiresDenoise);
  return (
    <div class="wb-form" data-wb-form="1" hidden>
      <div class="wb-pills" role="group" aria-label="方法">
        <button type="button" class="wb-pill wb-pill-on" data-wb-method="hires">
          hires
        </button>
        <button type="button" class="wb-pill" data-wb-method="canvas">
          canvas
        </button>
        <button type="button" class="wb-pill" data-wb-method="light">
          light（夕日・月明かり）
        </button>
      </div>
      <div data-wb-method-panel="hires">
        <label class="wb-field">
          長辺（px）
          <select name="wb_hires">
            <option value="2048" selected>
              2048
            </option>
            <option value="2560">2560</option>
            <option value="3072">3072</option>
          </select>
        </label>
        <label class="wb-field">
          denoise
          <select name="wb_hires_denoise">
            {hiresDenoises.map((v) => (
              <option value={String(v)} selected={v === hiresDenoise}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div data-wb-method-panel="canvas" hidden>
        <label class="wb-field">
          denoise <span class="mono" data-wb-denoise-readout>{canvasDenoise}</span>
          <input type="range" name="wb_denoise" min="0.2" max="0.8" step="0.05" value={String(canvasDenoise)} />
        </label>
        <DenoiseWords dials={data.redrawDials} />
        <label class="wb-field">
          寸法（長辺）
          <select name="wb_size">
            {sizes.map((v) => (
              <option value={String(v)} selected={v === canvasSize}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LightPanel data={data} />
      <label class="wb-field">
        <input type="checkbox" name="wb_redraw_no_cut" /> 切り抜かない
      </label>
    </div>
  );
}

function LightPanel({ data }: { data: WorkbenchData }) {
  const scenes = data.light ? data.light.scenes : Object.keys(LIGHT_SCENE_LABELS);
  const from = data.light ? data.light.defaultFrom : 'nw';
  return (
    <div data-wb-method-panel="light" hidden>
      <p class="wb-note" data-wb-light-input></p>
      <div class="wb-field">
        scene
        <div class="wb-pills" role="group" aria-label="scene">
          {scenes.map((scene, i) => (
            <button type="button" class={`wb-pill${i === 0 ? ' wb-pill-on' : ''}`} data-wb-scene={scene}>
              {LIGHT_SCENE_LABELS[scene] ?? scene} <span class="mono">{scene}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="wb-field">
        光の向き <span class="mono" data-wb-light-readout>from: {from}</span>
        <Compass name="light" value={from} />
      </div>
    </div>
  );
}

function DeliverForm({ data }: { data: WorkbenchData }) {
  const defaults = data.deliverDefaults;
  return (
    <div class="wb-form" data-wb-form="2" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <div class="wb-row">
          <span class="wb-note">透過で切り抜き、フチを付けます。背景は次のフェーズで付けます。</span>
        </div>

        <details class="wb-acc" open>
          <summary>
            フチ <span class="wb-acc-sub" data-wb-outline-summary></span>
          </summary>
          <OutlineEditor outlines={data.outlines} stroke={data.strokeDefault} />
        </details>

        <details class="wb-acc">
          <summary>詳細</summary>
          <div class="wb-acc-body">
            <label>
              <input type="checkbox" name="repin" checked={defaults?.repin === true} /> 彩度を圧縮する
            </label>
          </div>
        </details>
        <label class="backdrop-option-plain" hidden>
          <input type="radio" name="backdrop" value="transparent" checked />
        </label>
        <p class="wb-note">切り抜きは 2 回目から使い回します</p>
      </div>
    </div>
  );
}

function StageForm({ data }: { data: WorkbenchData }) {
  const patterns = data.backdrops.length > 0 ? data.backdrops : [{ name: 'stripes', label: '斜めストライプ' }];
  return (
    <div class="wb-form" data-wb-form="3" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <div class="wb-pills" role="group" aria-label="背景の種類">
          <button type="button" class="wb-pill wb-pill-on" data-wb-stage-mode="pattern">
            柄・単色
          </button>
          <button type="button" class="wb-pill" data-wb-stage-mode="photo">
            写真
          </button>
        </div>

        <div data-wb-stage-panel="pattern">
          <label class="wb-field wb-stage-scene" data-wb-stage-scene hidden>
            <span>
              <input type="checkbox" name="wb_stage_scene" checked /> <span data-wb-stage-scene-label></span>
            </span>
          </label>
          <div class="backdrop-picker wb-backdrops" data-backdrop-group>
            <label class="backdrop-option backdrop-option-plain" data-backdrop-value="random">
              <input type="radio" name="backdrop" value="random" checked />
              <span class="backdrop-option-label">ランダム</span>
            </label>
            {patterns.map((bd) => (
              <label class="backdrop-option" data-backdrop-value={bd.name}>
                <input type="radio" name="backdrop" value={bd.name} data-backdrop-pattern />
                {data.backdrops.length > 0 && data.recipeRef ? (
                  <img
                    class="backdrop-thumb"
                    src={backdropThumbnailUrl(data.recipeRef, data.catalogVersion, bd.name)}
                    alt={bd.label}
                    width="60"
                    height="96"
                    loading="lazy"
                  />
                ) : null}
                <span class="backdrop-option-label">{bd.label}</span>
              </label>
            ))}
            <label class="backdrop-option backdrop-option-plain" data-backdrop-value="color">
              <input type="radio" name="backdrop" value="color" />
              <span class="backdrop-option-label">単色</span>
            </label>
          </div>
          <input type="text" name="backdrop_color" placeholder="#RRGGBB" pattern="^#[0-9a-fA-F]{6}$" value={data.backdropColor ?? '#ffffff'} hidden disabled />
          <div class="wb-field">
            枠
            <div class="wb-pills" role="group" aria-label="枠">
              <button type="button" class="wb-pill wb-pill-on" data-wb-framed="on">
                枠あり
              </button>
              <button type="button" class="wb-pill" data-wb-framed="off">
                枠なし
              </button>
            </div>
          </div>
          <div class="wb-field">
            影 <span class="mono" data-wb-shadow-readout></span>
            <div class="wb-pills" role="group" aria-label="影">
              <button type="button" class="wb-pill wb-pill-on" data-wb-shadow="on">
                影あり
              </button>
              <button type="button" class="wb-pill" data-wb-shadow="off">
                影なし
              </button>
            </div>
          </div>
          <a class="wb-pill" data-wb-frame-link href="#" hidden>
            枠に入れる…
          </a>
        </div>

        <div data-wb-stage-panel="photo" hidden>
          <div class="wb-photo-grid" data-wb-photos>
            {data.photos.map((photo) => (
              <button
                type="button"
                class="wb-photo"
                data-wb-photo={photo.short_id}
                data-photo-id={photo.id}
                data-width={String(photo.image_width ?? '')}
                data-height={String(photo.image_height ?? '')}
                title={photo.original_filename ?? photo.short_id}
              >
                <img src={`/g/${photo.short_id}/preview`} alt={photo.original_filename ?? photo.short_id} loading="lazy" />
              </button>
            ))}
          </div>
          <label class="wb-field wb-photo-upload">
            写真を足す
            <input type="file" accept="image/*" data-wb-photo-file data-max-side={String(PHOTO_MAX_SIDE)} />
          </label>
          <span class="wb-note" data-wb-photo-status aria-live="polite"></span>
          <p class="wb-note">左の写真をクリックすると、そこに台座（板の下辺の中央）を置きます。</p>
          <label class="wb-field">
            高さ <span class="mono" data-wb-stage-height-readout>0.7</span>
            <input type="range" name="wb_stage_height" min="0.05" max="1.5" step="0.01" value="0.7" />
          </label>
        </div>
      </div>
    </div>
  );
}

function LightingForm() {
  return (
    <div class="wb-form" data-wb-form="4" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <p class="wb-note">背景の明るさと色味にキャラとフチを合わせます。向きを選ぶとその側から陰影も付けます。</p>
        <div class="wb-field">
          シーン
          <div class="wb-pills" role="group" aria-label="シーン">
            <button type="button" class="wb-pill wb-pill-on" data-wb-lighting-scene="">
              なし
            </button>
            <button type="button" class="wb-pill" data-wb-lighting-scene="sunset">
              夕日
            </button>
            <button type="button" class="wb-pill" data-wb-lighting-scene="moon">
              月明かり
            </button>
          </div>
          <span class="wb-note">夕日・月明かりはキャラをその光で照らし、柄の背景もその色に染めます（写真の背景はそのまま）。</span>
        </div>
        <label class="wb-field">
          強さ <span class="mono" data-wb-lighting-readout>0.7</span>
          <input type="range" name="wb_lighting_strength" min="0" max="1" step="0.05" value="0.7" />
        </label>
        <div class="wb-field">
          光の向き <span class="mono" data-wb-lighting-dir-readout>なし</span>
          <div class="wb-pills">
            <button type="button" class="wb-pill wb-pill-on" data-wb-lighting-none>
              向きなし
            </button>
          </div>
          <Compass name="lighting" value="" />
        </div>
      </div>
    </div>
  );
}

/** The full-frame lens a photo-set picture is shot through; the catalog lists them, so a new lens shows up here unchanged. */
function FocalLengthField({ dof }: { dof: DofCatalog }) {
  const lenses = dof.focalLength ?? FALLBACK_DOF.focalLength!;
  return (
    <label class="wb-field">
      レンズ（フルサイズ換算）
      <select name="wb_dof_focal_length">
        {lenses.values.map((value) => (
          <option value={value} selected={value === lenses.default}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}

function DofForm({ data }: { data: WorkbenchData }) {
  return (
    <div class="wb-form" data-wb-form="5" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <DofFields dof={data.dof ?? FALLBACK_DOF} />
        <div data-wb-dof-photo hidden>
          <p class="wb-note">写真に置いた絵: 写真の奥行きでボカします（ボカす範囲は使いません）。</p>
          <label class="wb-field">
            板を傾ける <span class="mono" data-wb-dof-readout="tilt">0</span>
            <input type="range" name="wb_dof_tilt" min="-1" max="1" step="0.05" value="0" />
          </label>
          <label class="wb-field">
            手前に寄せる <span class="mono" data-wb-dof-readout="nearer">0</span>
            <input type="range" name="wb_dof_nearer" min="0" max="1" step="0.05" value="0" />
          </label>
          <label class="wb-field">
            玉ボケ <span class="mono" data-wb-dof-readout="bokeh">0</span>
            <input type="range" name="wb_dof_bokeh" min="0" max="1" step="0.05" value="0" />
          </label>
          <FocalLengthField dof={data.dof ?? FALLBACK_DOF} />
        </div>
      </div>
    </div>
  );
}

/** `/work/:shortId`: the five-phase workbench. All dynamic parts are drawn by the client from `data-initial` (the tree and picks). */
export function WorkbenchPage({ path, data }: { path: string; data: WorkbenchData }) {
  const initial = { tree: data.tree, picks: data.picks, at: data.at };
  return (
    <Layout title={`ワークベンチ ${data.root.short_id}`} fullBleed path={path}>
      <div class="wb" data-workbench data-root-id={data.root.id} data-root-short-id={data.root.short_id} data-initial={JSON.stringify(initial)}>
        <div class="wb-head">
          <a class="wb-back" href="/work">
            元絵を選び直す
          </a>
          <nav class="wb-steps-nav" aria-label="フェーズ">
            <ol class="wb-steps wb-steps-fixed">
              <li>
                <button type="button" class="wb-step" data-wb-step="0" disabled>
                  <span class="wb-step-label">元絵</span>
                </button>
              </li>
              {PHASES.map((p) => (
                <li>
                  <span class="wb-step-sep" aria-hidden="true">
                    ›
                  </span>
                  <button type="button" class="wb-step" data-wb-step={String(p.no)} disabled>
                    <span class="wb-step-label">
                      {p.no}. {p.label}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        <div class="wb-main">
          <section class="wb-compare" aria-label="比較">
            <div class="wb-pair" data-wb-pair>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span>
                    入力 <span class="mono" data-wb-input-kind></span> <span class="wb-meta" data-wb-input-meta></span>
                  </span>
                  <span data-wb-pane-hint></span>
                  <CapActions side="input" />
                </figcaption>
                <div class="wb-pane" data-wb-input-pane></div>
              </figure>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span>
                    候補 <span class="mono" data-wb-cmp-kind></span> <span data-wb-cmp-badge></span> <span class="mono" data-wb-cmp-status></span>{' '}
                    <span class="wb-meta" data-wb-cmp-meta></span>
                  </span>
                  <CapActions side="cmp" />
                </figcaption>
                <div class="wb-pane" data-wb-cmp-pane></div>
              </figure>
            </div>
            <div class="wb-all" data-wb-all hidden></div>

            <div class="wb-controls">
              <div class="wb-strip" data-wb-strip role="list" aria-label="候補"></div>
              <div class="wb-pills" role="group" aria-label="比べ方">
                <button type="button" class="wb-pill wb-pill-on" data-wb-compare-mode="pair">
                  2 枚で比べる
                </button>
                <button type="button" class="wb-pill" data-wb-compare-mode="all">
                  同じフェーズを全部並べる
                </button>
              </div>
              <div class="wb-pills" role="group" aria-label="ルーペ">
                <button type="button" class="wb-pill wb-pill-on" data-wb-loupe-toggle title="z で切り替え">
                  ルーペ
                </button>
                {[2, 3, 5, 8].map((z) => (
                  <button type="button" class="wb-pill" data-wb-loupe-zoom={String(z)} title="[ ] で倍率">
                    ×{z}
                  </button>
                ))}
              </div>
              <button type="button" class="wb-pill" data-wb-skip></button>
              <button type="button" class="wb-adopt" data-wb-adopt></button>
            </div>
            <p class="wb-done" data-wb-done hidden>
              完成しました。
            </p>
          </section>

          <section class="wb-panel" aria-label="候補を作る">
            <div class="wb-panel-body">
              <div>
                <p class="wb-note">
                  フェーズ <span data-wb-phase-no>1</span> / 5
                </p>
                <h2 class="wb-panel-title">
                  <span data-wb-phase-title>描き直し</span>の候補を作る
                </h2>
              </div>
              <RedrawForm data={data} />
              <DeliverForm data={data} />
              <StageForm data={data} />
              <LightingForm />
              <DofForm data={data} />
            </div>
            <div class="wb-panel-foot">
              <p class="wb-error" data-wb-error role="alert" hidden></p>
              <button type="button" class="wb-run" data-wb-run></button>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
