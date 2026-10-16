import { Layout } from '../layout';
import { frameAssetVersion } from '../frame-editor';
import type { StageFrameDefaults } from '../../lib/catalogs';

export interface FrameEditorData {
  base: { id: string; short_id: string; width: number | null; height: number | null };
  layers: { figure: string; outline: string };
  backdrops: { name: string; label: string; thumbnail: string | null }[];
  /** 枠つきの stage 出力を開いたときの options (frame / backdrop / shadow_from)。無ければ null。 */
  initial: Record<string, unknown> | null;
  /** catalog の `stage.frame` の既定値。initial が無いときの初期値。 */
  defaults: StageFrameDefaults | null;
}

function Pill({ attrs, on, children }: { attrs: Record<string, string>; on?: boolean; children: unknown }) {
  return (
    <button type="button" class={on ? 'wb-pill wb-pill-on' : 'wb-pill'} {...attrs}>
      {children as string}
    </button>
  );
}

const SIDES: [string, string][] = [
  ['top', '上'],
  ['right', '右'],
  ['bottom', '下'],
  ['left', '左'],
];

export function FrameEditorPage({ path, data, requestedShortId }: { path: string; data: FrameEditorData; requestedShortId: string }) {
  return (
    <Layout title={`枠 ${requestedShortId}`} fullBleed path={path}>
      <div class="fr" id="frame-editor" data-initial={JSON.stringify(data)}>
        <div class="fr-head">
          <h1>枠 {requestedShortId}</h1>
          <a href={`/work/${data.base.short_id}`}>ワークベンチ {data.base.short_id}</a>
          <a href={`/g/${requestedShortId}`}>詳細 {requestedShortId}</a>
        </div>
        <div class="fr-body">
          <div class="fr-stage" id="fr-stage">
            <canvas id="fr-canvas" class="fr-canvas"></canvas>
            <p class="fr-note" id="fr-loading">
              読み込み中
            </p>
          </div>
          <div class="fr-panel">
            <section class="fr-section">
              <h2>ツール</h2>
              <div class="wb-pills" role="group" aria-label="ツール">
                <Pill attrs={{ 'data-fr-tool': 'box' }} on>
                  枠
                </Pill>
                <Pill attrs={{ 'data-fr-tool': 'erase' }}>消す</Pill>
                <Pill attrs={{ 'data-fr-tool': 'restore' }}>戻す</Pill>
                <Pill attrs={{ 'data-fr-tool': 'canvas', hidden: '' }}>範囲</Pill>
              </div>
              <label class="fr-row">
                ブラシ幅 <span class="mono" id="fr-brush-readout">2</span> %
                <input type="range" id="fr-brush" min="0.2" max="20" step="0.1" value="2" />
              </label>
              <div class="wb-pills">
                <button type="button" class="wb-pill" id="fr-undo" disabled>
                  取り消し
                </button>
                <button type="button" class="wb-pill" id="fr-redo" disabled>
                  やり直し
                </button>
                <button type="button" class="wb-pill" id="fr-clear-strokes" disabled>
                  ブラシを全部消す
                </button>
              </div>
            </section>
            <section class="fr-section">
              <h2>辺</h2>
              {SIDES.map(([side, label]) => (
                <div class="fr-row fr-side">
                  <span class="fr-side-label">{label}</span>
                  <Pill attrs={{ 'data-fr-side': side, 'data-fr-side-mode': 'cut' }}>切る</Pill>
                  <Pill attrs={{ 'data-fr-side': side, 'data-fr-side-mode': 'out' }}>はみ出す</Pill>
                </div>
              ))}
            </section>
            <section class="fr-section">
              <h2>背景</h2>
              <div class="fr-backdrops">
                {data.backdrops.map((bd) => (
                  <button type="button" class="fr-backdrop" data-fr-backdrop={bd.name} title={bd.label}>
                    {bd.thumbnail ? <img src={bd.thumbnail} alt={bd.label} width={48} height={72} loading="lazy" /> : null}
                    <span>{bd.label}</span>
                  </button>
                ))}
                <button type="button" class="fr-backdrop" data-fr-backdrop-solid>
                  <span>単色</span>
                </button>
              </div>
              <div class="fr-row">
                <input type="color" id="fr-solid-color" value="#ffffff" />
                <input type="text" id="fr-solid-hex" value="#ffffff" maxlength={7} placeholder="#RRGGBB" size={8} />
              </div>
            </section>
            <section class="fr-section">
              <h2>線と紙</h2>
              <label class="fr-row">
                線の色 <input type="color" id="fr-line-color" value="#885b80" />
              </label>
              <label class="fr-row">
                線の太さ <span class="mono" id="fr-line-readout">0.6</span> %
                <input type="range" id="fr-line-width" min="0" max="5" step="0.1" value="0.6" />
              </label>
              <label class="fr-row">
                縁の色 <input type="color" id="fr-rim-color" value="#2e2236" />
              </label>
              <label class="fr-row">
                縁の太さ <span class="mono" id="fr-rim-readout">0.25</span> %
                <input type="range" id="fr-rim-width" min="0" max="5" step="0.05" value="0.25" />
              </label>
              <label class="fr-row">
                紙の色 <input type="color" id="fr-paper" value="#ffffff" />
              </label>
            </section>
            <section class="fr-section">
              <h2>出力範囲</h2>
              <div class="wb-pills" role="group" aria-label="出力範囲">
                <Pill attrs={{ 'data-fr-canvas-mode': 'auto' }} on>
                  自動
                </Pill>
                <Pill attrs={{ 'data-fr-canvas-mode': 'manual' }}>指定</Pill>
              </div>
            </section>
            <section class="fr-section">
              <h2>影</h2>
              <div class="wb-pills" role="group" aria-label="影">
                <Pill attrs={{ 'data-fr-shadow': 'on' }} on>
                  影あり
                </Pill>
                <Pill attrs={{ 'data-fr-shadow': 'off' }}>影なし</Pill>
              </div>
            </section>
            <section class="fr-section">
              <p class="fr-note">
                ストローク <span id="fr-count-strokes">0</span>/200 · 点 <span id="fr-count-points">0</span>/20000
              </p>
              <button type="button" class="wb-pill wb-pill-on fr-submit" id="fr-submit" disabled>
                この枠で stage する
              </button>
              <p class="fr-note" id="fr-status" aria-live="polite"></p>
            </section>
          </div>
        </div>
      </div>
      <script src={`/assets/frame.js?v=${frameAssetVersion}`}></script>
    </Layout>
  );
}

export function FrameEditorUnavailablePage({ path, shortId }: { path: string; shortId: string }) {
  return (
    <Layout title={`枠 ${shortId}`} path={path}>
      <h1>枠 {shortId}</h1>
      <p>この絵には人物レイヤーがないので枠に入れられません。</p>
      <p>
        <a href={`/g/${shortId}`}>詳細へ戻る</a>
      </p>
    </Layout>
  );
}
