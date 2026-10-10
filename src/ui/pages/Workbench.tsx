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

export interface BackdropOption {
  name: string;
  label: string;
}

export interface WorkbenchPart {
  name: string;
  /** The part's text in the prompt that drew the source; null when the prompt's parts are unknown. */
  text: string | null;
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
  parts: WorkbenchPart[];
}

const PHASES = [
  { no: 1, label: '描き直し' },
  { no: 2, label: '光' },
  { no: 3, label: '部分' },
  { no: 4, label: '納品' },
  { no: 5, label: 'ボケ' },
] as const;

function numberDefault(fields: Record<string, unknown> | undefined, key: string): number | null {
  const value = fields?.[key];
  return typeof value === 'number' ? value : null;
}

function withValue(options: number[], value: number | null): number[] {
  return value !== null && !options.includes(value) ? [...options, value].sort((a, b) => a - b) : options;
}

function backdropThumbnailUrl(recipeRef: string, catalogVersion: string | null, name: string): string {
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
    </div>
  );
}

function LightForm({ data }: { data: WorkbenchData }) {
  const scenes = data.light ? data.light.scenes : Object.keys(LIGHT_SCENE_LABELS);
  const from = data.light ? data.light.defaultFrom : 'nw';
  return (
    <div class="wb-form" data-wb-form="2" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
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
    </div>
  );
}

const PART_MODES = [
  ['auto', '手足を自動で探す'],
  ['rect', '矩形を引く'],
] as const;

function PartForm({ data }: { data: WorkbenchData }) {
  return (
    <div class="wb-form" data-wb-form="3" hidden>
      <div class="wb-field">
        描き直す場所
        <div class="wb-pills" role="group" aria-label="描き直す場所">
          {PART_MODES.map(([mode, label], i) => (
            <button type="button" class={`wb-pill${i === 0 ? ' wb-pill-on' : ''}`} data-wb-part-mode={mode}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div data-wb-part-panel="auto">
        <label class="wb-field">
          対象
          <select name="wb_repair_parts">
            <option value="both">手と足</option>
            <option value="hands">手だけ</option>
            <option value="feet">足だけ</option>
          </select>
        </label>
      </div>
      <div data-wb-part-panel="rect" hidden>
        <div class="wb-rect-row">
          <span data-wb-rect-count>矩形 0 か所</span>
          <button type="button" class="wb-pill" data-wb-rect-clear>
            全部消す
          </button>
        </div>
        <label class="wb-field">
          足す語（必須）
          <input type="text" name="wb_patch" placeholder="例: holding mug" autocomplete="off" />
        </label>
        {data.parts.length > 0 ? (
          <div class="wb-field">
            元の絵の parts から足す
            <div class="wb-pills">
              {data.parts.map((part) => (
                <button type="button" class="wb-pill" data-wb-part-chip={part.name} data-part-text={part.text ?? ''}>
                  <span class="mono">{part.name}</span>
                </button>
              ))}
            </div>
            <span class="wb-note">元の prompt から顔・髪・構図の語を外し、足す語を末尾に付けて描き直します。</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeliverForm({ data }: { data: WorkbenchData }) {
  const defaults = data.deliverDefaults;
  const patterns = data.backdrops.length > 0 ? data.backdrops : [{ name: 'stripes', label: '斜めストライプ' }];
  return (
    <div class="wb-form" data-wb-form="4" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <div class="wb-row">
          <div class="wb-pills" role="group" aria-label="背景">
            <button type="button" class="wb-pill" data-wb-bg="transparent">
              透過
            </button>
            <button type="button" class="wb-pill wb-pill-on" data-wb-bg="backdrop">
              背景あり
            </button>
          </div>
          <label class="wb-inline-field">
            サイズ
            <select name="wb_deliver_size">
              <option value="1536" selected>
                1536
              </option>
              <option value="2048">2048</option>
            </select>
          </label>
        </div>

        <details class="wb-acc">
          <summary>
            フチ <span class="wb-acc-sub" data-wb-outline-summary></span>
          </summary>
          <OutlineEditor outlines={data.outlines} stroke={data.strokeDefault} />
        </details>

        <details class="wb-acc" data-wb-backdrop-patterns data-default="random">
          <summary>
            背景柄 <span class="wb-acc-sub" data-wb-backdrop-summary></span>
          </summary>
          <div class="wb-acc-body">
            <div class="backdrop-picker wb-backdrops" data-backdrop-group>
              <span class="dial-label">背景（backdrop）</span>
              <label class="backdrop-option backdrop-option-plain" data-backdrop-value="random">
                <input type="radio" name="backdrop" value="random" checked={false} />
                <span class="backdrop-option-label">ランダム</span>
              </label>
              {patterns.map((bd, i) => (
                <label class="backdrop-option" data-backdrop-value={bd.name}>
                  <input type="radio" name="backdrop" value={bd.name} checked={false} data-backdrop-pattern data-wb-backdrop-first={i === 0 ? '1' : undefined} />
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
                <input type="radio" name="backdrop" value="color" checked={false} />
                <span class="backdrop-option-label">単色</span>
              </label>
            </div>
            <label class="backdrop-option-plain" hidden>
              <input type="radio" name="backdrop" value="transparent" checked />
            </label>
            <input type="text" name="backdrop_color" placeholder="#RRGGBB" pattern="^#[0-9a-fA-F]{6}$" value={data.backdropColor ?? '#ffffff'} hidden disabled />
          </div>
        </details>

        <details class="wb-acc">
          <summary>詳細</summary>
          <div class="wb-acc-body">
            <label>
              <input type="checkbox" name="repin" checked={defaults?.repin === true} /> 彩度を圧縮する
            </label>
            <label>
              <input type="checkbox" name="recolor" checked={defaults?.recolor === true} /> パレットを揃える
            </label>
            <label>
              <input type="checkbox" name="skin" checked={defaults?.skin === true} /> 肌を整える
            </label>
            <label>
              <input type="checkbox" name="keep_legwear" checked={defaults?.keep_legwear === true} /> 脚衣を残す
            </label>
            <label>
              <input type="checkbox" name="keep_scene" checked={defaults?.keep_scene === true} /> 元の場面を残す
            </label>
          </div>
        </details>
        <p class="wb-note">切り抜きは 2 回目から使い回します</p>
      </div>
    </div>
  );
}

function DofForm({ data }: { data: WorkbenchData }) {
  return (
    <div class="wb-form" data-wb-form="5" hidden>
      <p class="wb-note wb-unavailable" data-wb-unavailable hidden></p>
      <div data-wb-form-body>
        <DofFields dof={data.dof ?? FALLBACK_DOF} />
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
              <LightForm data={data} />
              <PartForm data={data} />
              <DeliverForm data={data} />
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
