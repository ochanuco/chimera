// Static CSS/JS served by src/routes/assets.ts. Kept as plain strings (no
// bundler asset pipeline) per the "no external CDN" constraint in docs/ui.md.

export const styleCss = `
:root {
  color-scheme: dark;
  --bg: #121214;
  --bg-elevated: #1b1b1f;
  --border: #2b2b31;
  --text: #e8e8ec;
  --text-dim: #97979f;
  --accent: #7c9cf5;
  --good: #5fbf7b;
  --neutral: #b8ab5f;
  --bad: #d4695f;
  --graph-reference: #6fa8fd;
  --graph-relation: #e2914f;
  --graph-story: #4fd8a4;
  --nav-h: 3.25rem;
  --thumb-ar: 2 / 3;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.5;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.nav {
  height: var(--nav-h);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  position: sticky;
  top: 0;
  z-index: 10;
}
.nav a { color: var(--text); font-weight: 600; }
.nav a.brand { color: var(--accent); margin-right: 0.5rem; }

.container { padding: 1.25rem; max-width: 1600px; margin: 0 auto; }
.container-full { max-width: none; }

h1, h2, h3 { font-weight: 600; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.1rem; margin-top: 2rem; }

.filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.9rem;
  margin-bottom: 1.25rem;
}
.filter-form label {
  display: flex;
  flex-direction: column;
  font-size: 0.75rem;
  color: var(--text-dim);
  gap: 0.25rem;
}
.filter-form input, .filter-form select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  font-size: 0.85rem;
}
.filter-form .checkbox-field { flex-direction: row; align-items: center; gap: 0.4rem; }
.filter-form-lookup {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--border);
  opacity: 0.8;
}
.filter-form-lookup label {
  display: flex;
  flex-direction: column;
  font-size: 0.7rem;
  color: var(--text-dim);
  gap: 0.25rem;
}
.filter-form-lookup input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
}
.filter-form button {
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-weight: 600;
  cursor: pointer;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 1rem;
}

.card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.card .thumb-link { display: block; position: relative; aspect-ratio: var(--thumb-ar); overflow: hidden; background: #000; }
.card .thumb-link img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.card .thumb-link .thumb-bg { object-fit: cover; filter: blur(14px) brightness(0.7); transform: scale(1.2); }
.card .thumb-link .thumb-fg { object-fit: contain; }
.card-body { padding: 0.55rem 0.6rem 0.7rem; display: flex; flex-direction: column; gap: 0.4rem; }

#thumb-preview {
  position: fixed;
  display: none;
  pointer-events: none;
  z-index: 100;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
/* 親の高さが auto だと max-height: 100% は効かないため、img に直接ビューポート基準の上限を課す。
   26px = 外側マージン 8px×2 + パディング 4px×2 + ボーダー 1px×2（枠ごとビューポートに収める） */
#thumb-preview img { display: block; max-width: calc(100vw - 26px); max-height: calc(100vh - 26px); border-radius: 6px; }
#thumb-preview.visible { display: block; }
.card-top-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.card-image-meta { margin: 0; text-align: left; }
.short-id-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: var(--text); }
/* Root-scoped jump into Graph View from a detail page heading (the only in-app entry to /graph). */
.graph-jump {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  text-decoration: none;
  vertical-align: middle;
}
.graph-jump:hover { color: var(--accent); border-color: var(--accent); }

.copy-id-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 0.8rem;
  line-height: 1;
  padding: 0.1rem 0.15rem;
  cursor: pointer;
}
.copy-id-btn:hover { color: var(--text); }

.rating-group { display: flex; gap: 0.25rem; }
.rate-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 5px;
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
}
.rate-btn[data-rating="good"].active { background: var(--good); color: #0c1a10; border-color: var(--good); }
.rate-btn[data-rating="neutral"].active { background: var(--neutral); color: #1c1808; border-color: var(--neutral); }
.rate-btn[data-rating="bad"].active { background: var(--bad); color: #200a08; border-color: var(--bad); }

.bookmark-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  opacity: 0.35;
  filter: grayscale(1);
}
.bookmark-btn[data-bookmarked="true"] { opacity: 1; filter: none; }

.tag-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.tag-chip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  font-size: 0.7rem;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.tag-remove-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0; font-size: 0.75rem; }

/* Relation-type badges for 親/子/兄弟 rows (Batch/Generation Detail). Colors match the Graph legend. */
.rel-badge {
  display: inline-block;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  font-size: 0.68rem;
  font-weight: 600;
  white-space: nowrap;
}
.rel-badge.rel-reference { background: color-mix(in srgb, var(--graph-reference) 22%, transparent); color: var(--graph-reference); }
.rel-badge.rel-refinement { background: color-mix(in srgb, var(--graph-relation) 22%, transparent); color: var(--graph-relation); }
.rel-badge.rel-story { background: color-mix(in srgb, var(--graph-story) 22%, transparent); color: var(--graph-story); }

/* 親/子/兄弟 セクションのサムネイルカード（FamilyCard）。GenerationCard/.card より軽量で横並びに畳める。 */
.family-strip { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.family-card {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  width: 220px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.4rem 0.55rem;
  text-decoration: none;
  color: inherit;
}
.family-card:hover { border-color: var(--accent); }
.family-card-thumb { flex: none; width: 44px; height: 44px; border-radius: 6px; overflow: hidden; background: #000; }
.family-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.family-card-thumb-empty { width: 100%; height: 100%; background: var(--bg); }
.family-card-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.family-card-top { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.family-card-caption { font-size: 0.65rem; color: var(--text-dim); }
.family-card-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; color: var(--text); }
.family-card-detail {
  font-size: 0.7rem;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 系譜ミニマップ（MiniMap）。画像なし・short_idのみの一列表示で「今どこにいるか」を一目で示す。 */
.mini-map { display: flex; flex-direction: column; gap: 0.4rem; }
.mini-map-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; font-size: 0.78rem; }
.mini-map-label { color: var(--text-dim); flex: none; }
.mini-map-chain { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.mini-map-sep { color: var(--text-dim); }
.mini-map-item { color: var(--text-dim); }
.mini-map-item:hover { color: var(--accent); }
.mini-map-current { color: var(--accent); font-weight: 600; }

.tag-add-form { display: flex; gap: 0.3rem; }
.tag-add-form input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
  font-size: 0.72rem;
  width: 7rem;
}
.tag-add-form button {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.72rem;
}

.compare-check-row { display: flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: var(--text-dim); }

.compare-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  padding: 0.7rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  z-index: 20;
}
.compare-bar.hidden { display: none; }
.compare-bar a.compare-go {
  background: var(--accent);
  color: #10131c;
  border-radius: 6px;
  padding: 0.4rem 0.9rem;
  font-weight: 600;
}

.pagination { display: flex; gap: 1rem; align-items: center; margin: 1.5rem 0; }
.pagination .disabled { color: var(--text-dim); pointer-events: none; }

details.section {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  margin-bottom: 0.6rem;
}
details.section summary { cursor: pointer; font-weight: 600; }
details.section .section-body { margin-top: 0.6rem; }

.section-sub { margin-top: 0.4rem; }
.section-sub summary { cursor: pointer; color: var(--text-dim); font-size: 0.8rem; }

.kv-table { border-collapse: collapse; width: 100%; }
.kv-table td { padding: 0.2rem 0.5rem 0.2rem 0; vertical-align: top; font-size: 0.85rem; }
.kv-table td:first-child { color: var(--text-dim); white-space: nowrap; }

/* Batch Detail の Prompt セクション: 生文字列テーブルの代わりにトークンチップで表示する。 */
.prompt-diff-base { font-size: 0.75rem; color: var(--text-dim); margin: 0 0 0.5rem; }
.prompt-field { margin-bottom: 0.7rem; }
.prompt-field:last-of-type { margin-bottom: 0; }
.prompt-field-label {
  font-size: 0.72rem;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.3rem;
}
.prompt-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.prompt-chip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  font-size: 0.75rem;
  color: var(--text);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.prompt-chips.negative .prompt-chip { color: var(--text-dim); border-color: var(--border); background: color-mix(in srgb, var(--bg-elevated) 60%, transparent); }
.prompt-chip.chip-lora { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); color: var(--accent); }
.prompt-chip.chip-break { border-style: dashed; color: var(--text-dim); }
.prompt-chip.diff-added { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
.prompt-chip.diff-weight { border-color: var(--neutral); box-shadow: inset 0 0 0 1px var(--neutral); }
.prompt-chip.diff-removed { border-color: var(--bad); color: var(--text-dim); text-decoration: line-through; }
.prompt-removed { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.4rem; }
.w-badge { font-size: 0.65rem; border-radius: 4px; padding: 0 0.3rem; background: var(--bg-elevated); color: var(--text-dim); }
.w-badge.w-up { color: var(--good); background: color-mix(in srgb, var(--good) 18%, transparent); }
.w-badge.w-down { color: var(--text-dim); background: color-mix(in srgb, var(--border) 60%, transparent); }
.prompt-raw { white-space: pre-wrap; font-size: 0.85rem; margin: 0; }

.gen-detail-hero { text-align: center; margin-bottom: 1rem; }
.gen-detail-hero img { max-width: 100%; max-height: 70vh; border-radius: 10px; border: 1px solid var(--border); }
.image-meta { margin-top: 0.4rem; font-size: 0.78rem; color: var(--text-dim); text-align: center; }

.detail-layout { display: block; }
@media (min-width: 1100px) {
  .detail-layout {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.25rem;
    height: calc(100vh - var(--nav-h) - 2.5rem);
    overflow: hidden;
  }
  /* 縦 flex にして画像へ残り全高を割り当てる。hero を height: 100% にすると
     直後の .image-meta がスクロール下に押し出されて見えなくなる */
  .detail-left { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .detail-right { overflow-y: auto; min-height: 0; }

  .detail-left .gen-detail-hero { flex: 1; min-height: 0; margin-bottom: 0; }
  .detail-left .gen-detail-hero img { max-height: 100%; max-width: 100%; object-fit: contain; }

  .detail-right { font-size: 0.85rem; }
  .detail-right h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
  .detail-right details.section { padding: 0.5rem 0.7rem; margin-bottom: 0.5rem; }

  /* 固定配置の compare バー表示中はペイン末尾がバーに隠れるため、バー高さ分の余白を足す */
  .detail-layout:has(~ #compare-bar:not(.hidden)) .detail-left,
  .detail-layout:has(~ #compare-bar:not(.hidden)) .detail-right {
    padding-bottom: 3.5rem;
  }
}

.note-form textarea {
  width: 100%;
  min-height: 5rem;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.5rem;
  font-family: inherit;
}
.note-form button {
  margin-top: 0.4rem;
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}
.save-status { margin-left: 0.5rem; font-size: 0.8rem; color: var(--text-dim); }

.batch-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem;
  margin-bottom: 0.6rem;
}
.batch-row img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; background: #000; }
.batch-row .batch-meta { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
.batch-row .instruction-excerpt { color: var(--text-dim); font-size: 0.8rem; }

.hidden { display: none !important; }

.story-tree ul { list-style: none; padding-left: 1.4rem; border-left: 1px dashed var(--border); }
.story-tree li { margin: 0.5rem 0; }
.story-node { display: flex; align-items: center; gap: 0.6rem; }
.story-node img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; background: #000; }
.rel-edit-form { display: flex; gap: 0.4rem; margin-top: 0.3rem; }
.rel-edit-form input, .rel-edit-form textarea {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  font-size: 0.78rem;
}

.compare-cols-picker { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.75rem; font-size: 0.8rem; color: var(--text-dim); }
.compare-cols-picker select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  font-size: 0.8rem;
}
/* grid の auto-fill で列幅を全行共通にする（flex-wrap だと折り返し後の行だけカードが伸びる）。
   列数指定時は initCompareCols が grid-template-columns をインラインで上書きする */
.compare-columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 320px)); gap: 1rem; }
.compare-col { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem; }
.compare-col img { width: 100%; border-radius: 6px; margin-bottom: 0.5rem; }
.compare-meta { font-size: 0.8rem; color: var(--text-dim); }

.compare-table-wrap { overflow-x: auto; margin-top: 1.25rem; }
.compare-table { border-collapse: collapse; width: 100%; min-width: 480px; }
.compare-table th, .compare-table td {
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
}
.compare-table th { color: var(--text-dim); font-weight: 600; white-space: nowrap; }
.compare-table td:first-child { color: var(--text-dim); white-space: nowrap; }
.compare-table td.diff {
  border-left: 3px solid var(--neutral);
  background: rgba(184, 171, 95, 0.07);
}
.compare-table .tok-uniq { background: rgba(95, 191, 123, 0.3); border-radius: 2px; }
.compare-table .tok-partial { background: rgba(184, 171, 95, 0.35); border-radius: 2px; }
.compare-legend { font-size: 0.75rem; color: var(--text-dim); margin: 0.75rem 0 0.25rem; }
.compare-legend .tok-uniq, .compare-legend .tok-partial { padding: 0 0.25rem; }

.empty-state { color: var(--text-dim); padding: 2rem 0; }
.bookmark-section { margin-bottom: 2rem; }

.graph-scope-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}
.graph-scope-label { color: var(--text-dim); }

.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-dim);
}
.legend-row { display: flex; align-items: center; gap: 0.4rem; white-space: nowrap; }
.legend-swatch { display: inline-block; width: 22px; height: 0; border-top-width: 3px; border-top-style: solid; }
.legend-swatch.legend-reference { border-color: var(--graph-reference); }
.legend-swatch.legend-relation { border-color: var(--graph-relation); border-top-style: dashed; }
.legend-swatch.legend-story { border-color: var(--graph-story); }

.graph-stage { position: relative; }
.graph-zoom-controls {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.graph-zoom-controls button {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--fg);
  font-size: 1rem;
  cursor: pointer;
}
.graph-zoom-controls button:hover { border-color: var(--accent); }

.graph-viewport {
  position: relative;
  height: 78vh;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}
/* Fill the frame so the whole viewport is pan/zoom-able; without JS the
   viewBox still shows the entire graph scaled to fit. */
#graph-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; transform-origin: 0 0; }
#graph-svg.dragging { cursor: grabbing; }

.graph-node-card { fill: var(--bg-elevated); stroke: var(--border); stroke-width: 1; }
.graph-batch-header { cursor: default; }
.graph-node-shortid {
  fill: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
.graph-node-status { fill: var(--text-dim); font-size: 11px; }

.graph-gen-thumb { cursor: pointer; }
.graph-gen-ring { fill: none; stroke: transparent; stroke-width: 2; }
.graph-gen-thumb.rating-good .graph-gen-ring { stroke: var(--good); }
.graph-gen-thumb.selected .graph-gen-ring { stroke: var(--accent); stroke-width: 3; }
.graph-gen-empty { fill: #000; stroke: var(--border); stroke-dasharray: 4 3; }

.graph-node-stub { cursor: pointer; }
.graph-node-stub rect { fill: var(--bg); stroke: var(--border); stroke-dasharray: 4 3; }
.graph-node-stub:hover rect { stroke: var(--accent); }
.graph-node-stub text { fill: var(--text-dim); font-size: 11px; }

/* Retry-chain collapse badge ("⟳N" -- expand) and re-collapse badge ("⟲" -- collapse back). */
.graph-node-chain { cursor: pointer; }
.graph-node-chain rect { fill: var(--accent); stroke: var(--accent); }
.graph-node-chain:hover rect { opacity: 0.85; }
.graph-node-chain text { fill: var(--bg); font-size: 11px; font-weight: 600; }

.graph-node-recollapse { cursor: pointer; }
.graph-node-recollapse circle { fill: var(--bg-elevated); stroke: var(--accent); stroke-width: 1.5; }
.graph-node-recollapse:hover circle { fill: var(--accent); }
.graph-node-recollapse text { fill: var(--accent); font-size: 11px; }
.graph-node-recollapse:hover text { fill: var(--bg); }

.graph-context-menu {
  position: fixed;
  z-index: 30;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
  min-width: 170px;
}
.graph-context-menu.hidden { display: none; }
.graph-context-menu-item {
  background: none;
  border: none;
  color: var(--text);
  text-align: left;
  padding: 0.45rem 0.65rem;
  font-size: 0.82rem;
  border-radius: 5px;
  cursor: pointer;
}
.graph-context-menu-item:hover { background: var(--bg); }

.graph-edge path { fill: none; stroke-width: 2; }
.graph-edge.edge-reference path { stroke: var(--graph-reference); }
.graph-edge.edge-relation path { stroke: var(--graph-relation); stroke-dasharray: 7 5; }
.graph-edge.edge-story path { stroke: var(--graph-story); }
/* Font size / outline are overridden per zoom level by initGraphPanZoom so the
   labels stay a constant on-screen size (matching the legend text). The static
   values are the no-JS fallback. */
.graph-edge text {
  font-size: var(--graph-edge-font, 13px);
  fill: var(--text);
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: var(--graph-edge-stroke, 4px);
  stroke-linejoin: round;
}

/* Experiments */
.status-badge {
  display: inline-block;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
  background: color-mix(in srgb, var(--neutral) 22%, transparent);
  color: var(--neutral);
}
.status-badge[data-value="active"] { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
.status-badge[data-value="stabilized"] { background: color-mix(in srgb, var(--good) 22%, transparent); color: var(--good); }
.status-badge[data-value="promoted"] { background: color-mix(in srgb, var(--good) 22%, transparent); color: var(--good); }
.status-badge[data-value="abandoned"] { background: color-mix(in srgb, var(--text-dim) 22%, transparent); color: var(--text-dim); }
.status-badge[data-value="pass"] { background: color-mix(in srgb, var(--good) 22%, transparent); color: var(--good); }
.status-badge[data-value="fail"] { background: color-mix(in srgb, var(--bad) 22%, transparent); color: var(--bad); }
.status-badge[data-value="proposed"] { background: color-mix(in srgb, var(--neutral) 22%, transparent); color: var(--neutral); }
.status-badge[data-value="applied"] { background: color-mix(in srgb, var(--good) 22%, transparent); color: var(--good); }
.status-badge[data-value="rejected"] { background: color-mix(in srgb, var(--bad) 22%, transparent); color: var(--bad); }

.exp-short-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; color: var(--text-dim); }
.exp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }

.exp-status-row { margin: 0.5rem 0 1rem; }
.exp-status-select {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
}

.exp-run {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.8rem 1rem;
  margin-bottom: 0.9rem;
  background: var(--bg-elevated);
}
.exp-run-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.exp-run-index { font-weight: 600; }
.exp-run-objective { color: var(--text-dim); font-size: 0.85rem; }

.exp-delta { font-size: 0.8rem; margin-bottom: 0.5rem; }
.exp-delta-label { color: var(--text-dim); margin-bottom: 0.2rem; }
.exp-delta-line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.exp-delta-path { color: var(--text-dim); }
.exp-delta-added { color: var(--good); }
.exp-delta-removed { color: var(--bad); }
.exp-delta-changed { color: var(--accent); }
.exp-delta-kept { color: var(--text-dim); }
.exp-delta-reason { color: var(--text-dim); font-style: italic; }
.exp-delta-empty { color: var(--text-dim); font-style: italic; }

.exp-run-thumb { display: flex; align-items: center; gap: 0.6rem; margin: 0.6rem 0; }
.exp-run-thumb img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; background: #000; }
.exp-run-batch-link { font-size: 0.82rem; }

.exp-evaluation, .exp-decision { margin-top: 0.6rem; font-size: 0.85rem; }
.exp-evaluation-head, .exp-decision-head { display: flex; align-items: center; gap: 0.4rem; font-weight: 600; margin-bottom: 0.3rem; }
.exp-aspects { margin-bottom: 0.3rem; }
.exp-notes { margin: 0.2rem 0; padding-left: 1.2rem; color: var(--text-dim); }
.exp-decision-action {
  display: inline-block;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
}
.exp-decision-reason { color: var(--text-dim); margin: 0.2rem 0; }

.exp-promotion {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.8rem 1rem;
  margin-bottom: 0.9rem;
  background: var(--bg-elevated);
}
.exp-promotion-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
.exp-promotion-target { font-weight: 600; }
.exp-promotion-meta { color: var(--text-dim); font-size: 0.78rem; }
`;

export const appJs = `
(function () {
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  async function api(url, method, body) {
    const res = await fetch(url, {
      method: method || 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = await res.json();
        if (data && data.error && data.error.message) message = data.error.message;
      } catch (e) {}
      throw new Error(message || ('request failed: ' + res.status));
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.indexOf('application/json') !== -1 ? res.json() : null;
  }

  // --- Clipboard helpers (used by copy-id buttons and the Graph context menu) ---
  function flashCopied(btn, text) {
    const original = btn.textContent;
    btn.textContent = text || 'Copied';
    setTimeout(function () { btn.textContent = original; }, 900);
  }

  function copyText(text, btn, flashText) {
    try {
      navigator.clipboard.writeText(text).then(function () {
        flashCopied(btn, flashText);
      }).catch(function () {});
    } catch (e) {}
  }

  // --- Copy-id buttons (short_id / prompt_id displays across the app) ---
  function initCopyIdButtons() {
    document.addEventListener('click', function (ev) {
      const btn = ev.target.closest('.copy-id-btn');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const value = btn.getAttribute('data-copy-id');
      if (!value) return;
      copyText(value, btn, '✓');
    });
  }

  // --- Compare column-count picker ---
  function initCompareCols() {
    const select = document.getElementById('compare-cols');
    const grid = document.querySelector('.compare-columns');
    if (!select || !grid) return;
    const STORE_KEY = 'chimera-compare-cols';
    function apply(value) {
      grid.style.gridTemplateColumns = value === 'auto' ? '' : 'repeat(' + value + ', minmax(0, 1fr))';
    }
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { /* localStorage unavailable */ }
    if (stored && select.querySelector('option[value="' + stored + '"]')) {
      select.value = stored;
      apply(stored);
    }
    select.addEventListener('change', function () {
      apply(select.value);
      try { localStorage.setItem(STORE_KEY, select.value); } catch (e) { /* localStorage unavailable */ }
    });
  }

  // --- Rating ---
  function initRating() {
    document.addEventListener('click', async function (ev) {
      const btn = ev.target.closest('.rate-btn');
      if (!btn) return;
      const group = btn.closest('.rating-group');
      const id = group.getAttribute('data-generation-id');
      const current = group.getAttribute('data-current') || '';
      const clicked = btn.getAttribute('data-rating');
      const next = current === clicked ? null : clicked;
      try {
        await api('/api/v1/generations/' + id + '/rating', 'PUT', { rating: next });
        group.setAttribute('data-current', next || '');
        qsa('.rate-btn', group).forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-rating') === next);
        });
      } catch (e) {
        alert('rating update failed: ' + e.message);
      }
    });
  }

  // --- Bookmark ---
  function initBookmark() {
    document.addEventListener('click', async function (ev) {
      const btn = ev.target.closest('.bookmark-btn');
      if (!btn) return;
      const kind = btn.getAttribute('data-kind');
      const id = btn.getAttribute('data-id');
      const bookmarked = btn.getAttribute('data-bookmarked') === 'true';
      const method = bookmarked ? 'DELETE' : 'PUT';
      try {
        await api('/api/v1/' + kind + '/' + id + '/bookmark', method);
        btn.setAttribute('data-bookmarked', bookmarked ? 'false' : 'true');
      } catch (e) {
        alert('bookmark update failed: ' + e.message);
      }
    });
  }

  // --- Experiment status transition ---
  function initExperimentStatus() {
    document.addEventListener('change', async function (ev) {
      const select = ev.target.closest('.exp-status-select');
      if (!select) return;
      const id = select.getAttribute('data-id');
      const previous = select.getAttribute('data-current');
      const next = select.value;
      try {
        await api('/api/v1/experiments/' + id, 'PATCH', { status: next });
        select.setAttribute('data-current', next);
        location.reload();
      } catch (e) {
        alert('status update failed: ' + e.message);
        select.value = previous;
      }
    });
  }

  // --- Thumbnail hover preview ---
  function initThumbPreview() {
    if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;

    const preview = document.createElement('div');
    preview.id = 'thumb-preview';
    const previewImg = document.createElement('img');
    preview.appendChild(previewImg);
    document.body.appendChild(preview);

    let timer = null;
    let currentLink = null;
    let mouseX = 0;
    let mouseY = 0;

    function hide() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      preview.classList.remove('visible');
      currentLink = null;
    }

    function show(link) {
      const fg = link.querySelector('.thumb-fg');
      if (!fg || !fg.src) return;
      previewImg.src = fg.src;
      preview.classList.add('visible');
      position();
      // 未キャッシュ画像は load 後にサイズが確定するため再配置する
      previewImg.onload = function () {
        if (currentLink === link) position();
      };
    }

    function position() {
      const margin = 8;
      const offset = 16;
      const pw = preview.offsetWidth;
      const ph = preview.offsetHeight;
      let left = mouseX + offset;
      if (left + pw > window.innerWidth - margin) left = mouseX - offset - pw;
      if (left < margin) left = margin;
      let top = mouseY + offset;
      if (top + ph > window.innerHeight - margin) top = mouseY - offset - ph;
      if (top < margin) top = margin;
      preview.style.left = left + 'px';
      preview.style.top = top + 'px';
    }

    document.addEventListener('mousemove', function (ev) {
      mouseX = ev.clientX;
      mouseY = ev.clientY;
      if (preview.classList.contains('visible')) position();
    });

    document.addEventListener('mouseover', function (ev) {
      const link = ev.target.closest ? ev.target.closest('.thumb-link') : null;
      if (!link || link === currentLink) return;
      if (timer) clearTimeout(timer);
      currentLink = link;
      timer = setTimeout(function () {
        timer = null;
        show(link);
      }, 200);
    });

    document.addEventListener('mouseout', function (ev) {
      const link = ev.target.closest ? ev.target.closest('.thumb-link') : null;
      if (!link) return;
      const related = ev.relatedTarget;
      if (related && link.contains(related)) return;
      hide();
    });

    document.addEventListener('click', hide);
    window.addEventListener('scroll', hide, true);
  }

  // --- Tag add ---
  function initTagAdd() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.tag-add-form');
      if (!form) return;
      ev.preventDefault();
      const kind = form.getAttribute('data-kind');
      const id = form.getAttribute('data-id');
      const input = qs('input[name="name"]', form);
      const name = (input.value || '').trim();
      if (!name) return;
      try {
        const tag = await api('/api/v1/' + kind + '/' + id + '/tags', 'POST', { name: name, created_by: 'human' });
        const container = form.parentElement.querySelector('.tag-chips');
        if (container) {
          const existingChip = container.querySelector('[data-tag-id="' + tag.id + '"]');
          if (!existingChip) {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.setAttribute('data-tag-id', tag.id);
            const label = document.createElement('span');
            label.textContent = '#' + tag.name;
            chip.appendChild(label);
            if (form.hasAttribute('data-removable')) {
              const removeBtn = document.createElement('button');
              removeBtn.type = 'button';
              removeBtn.className = 'tag-remove-btn';
              removeBtn.setAttribute('data-kind', kind);
              removeBtn.setAttribute('data-id', id);
              removeBtn.setAttribute('data-tag-id', tag.id);
              removeBtn.textContent = '\\u00d7';
              chip.appendChild(removeBtn);
            }
            container.appendChild(chip);
          }
        }
        input.value = '';
      } catch (e) {
        alert('failed to add tag: ' + e.message);
      }
    });
  }

  // --- Tag remove ---
  function initTagRemove() {
    document.addEventListener('click', async function (ev) {
      const btn = ev.target.closest('.tag-remove-btn');
      if (!btn) return;
      const kind = btn.getAttribute('data-kind');
      const id = btn.getAttribute('data-id');
      const tagId = btn.getAttribute('data-tag-id');
      try {
        await api('/api/v1/' + kind + '/' + id + '/tags/' + tagId, 'DELETE');
        btn.closest('.tag-chip').remove();
      } catch (e) {
        alert('failed to remove tag: ' + e.message);
      }
    });
  }

  // --- Tag suggestions ---
  function initTagSuggestions() {
    let debounceTimer = null;
    let abortController = null;
    document.addEventListener('input', async function (ev) {
      const input = ev.target.closest('.tag-add-form input[name="name"]');
      if (!input) return;
      const q = input.value.trim();

      // Clear previous timer
      if (debounceTimer) clearTimeout(debounceTimer);
      // Abort previous request
      if (abortController) abortController.abort();

      if (!q) return;

      debounceTimer = setTimeout(async function () {
        abortController = new AbortController();
        try {
          const res = await fetch('/api/v1/tags?q=' + encodeURIComponent(q), {
            signal: abortController.signal
          });
          if (!res.ok) return;
          const data = await res.json();
          const listId = input.getAttribute('list');
          const list = listId ? document.getElementById(listId) : null;
          if (list) {
            list.innerHTML = '';
            (data.items || []).forEach(function (t) {
              const opt = document.createElement('option');
              opt.value = t.name;
              list.appendChild(opt);
            });
          }
        } catch (e) {
          if (e.name !== 'AbortError') {
            // Ignore abort errors, log others silently
          }
        }
      }, 200);
    });
  }

  // --- Note editing ---
  function initNoteForm() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.note-form');
      if (!form) return;
      ev.preventDefault();
      const kind = form.getAttribute('data-kind');
      const id = form.getAttribute('data-id');
      const textarea = qs('textarea[name="note"]', form);
      const status = qs('.save-status', form);
      try {
        await api('/api/v1/' + kind + '/' + id, 'PATCH', { note: textarea.value });
        if (status) {
          status.textContent = 'saved';
          setTimeout(function () { status.textContent = ''; }, 1500);
        }
      } catch (e) {
        if (status) status.textContent = 'failed: ' + e.message;
      }
    });
  }

  // --- Compare selection bar ---
  // Feeds off two independent selection sources: Gallery's checkboxes
  // (.compare-check) and Graph's clicked-to-select thumbnails (.graph-gen-thumb.selected).
  function collectCompareIds() {
    const ids = qsa('.compare-check:checked').map(function (c) { return c.value; });
    qsa('.graph-gen-thumb.selected').forEach(function (t) {
      const id = t.getAttribute('data-gen-short-id');
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }
  function updateCompareBar() {
    const bar = document.getElementById('compare-bar');
    if (!bar) return;
    const ids = collectCompareIds();
    if (ids.length > 0) {
      bar.classList.remove('hidden');
      const displayCount = Math.min(ids.length, 9);
      qs('#compare-count', bar).textContent = 'Compare (' + displayCount + ')';
      qs('#compare-link', bar).setAttribute('href', '/compare?ids=' + ids.slice(0, 9).join(','));
    } else {
      bar.classList.add('hidden');
    }
  }
  function initCompareBar() {
    const bar = document.getElementById('compare-bar');
    if (!bar) return;
    document.addEventListener('change', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('compare-check')) updateCompareBar();
    });
    updateCompareBar();
  }

  // --- Graph thumbnail selection (feeds the compare bar) ---
  function initGraphSelection() {
    const svg = document.getElementById('graph-svg');
    if (!svg) return;
    svg.addEventListener('click', function (ev) {
      const thumb = ev.target.closest ? ev.target.closest('.graph-gen-thumb') : null;
      if (!thumb) return;
      thumb.classList.toggle('selected');
      updateCompareBar();
    });
  }

  // --- Graph scope selector (filters which Batches /graph renders) ---
  // Scope lives only in the URL query string -- no localStorage persistence.
  function goToGraphScope(query) {
    window.location.href = query ? '/graph?' + query : '/graph';
  }

  function initGraphScope() {
    var select = document.getElementById('graph-scope');
    if (!select) return;
    select.addEventListener('change', function () {
      var value = select.value;
      var query = '';
      if (value === 'active') query = 'active=1';
      else if (value === 'all') query = 'all=1';
      else if (value.indexOf('story:') === 0) query = 'story=' + value.slice('story:'.length);
      else if (value.indexOf('root:') === 0) query = 'root=' + value.slice('root:'.length);
      goToGraphScope(query);
    });
  }

  // --- Graph drill-down stub (hidden-neighbor placeholder) ---
  function initGraphStubs() {
    var svg = document.getElementById('graph-svg');
    if (!svg) return;
    svg.addEventListener('click', function (ev) {
      var stub = ev.target.closest ? ev.target.closest('.graph-node-stub') : null;
      if (!stub) return;
      var shortId = stub.getAttribute('data-batch-short-id');
      if (!shortId) return;
      goToGraphScope('root=' + shortId + '&depth=3');
    });
  }

  // --- Graph chain-collapse badges ("⟳N" expand / "⟲" re-collapse) ---
  // Unlike the scope selector, these preserve every other query param -- only expand changes.
  function withExpandParam(shortId, add) {
    var params = new URLSearchParams(window.location.search);
    var ids = (params.get('expand') || '').split(',').filter(Boolean);
    if (add) {
      if (ids.indexOf(shortId) === -1) ids.push(shortId);
    } else {
      ids = ids.filter(function (id) { return id !== shortId; });
    }
    if (ids.length > 0) params.set('expand', ids.join(','));
    else params.delete('expand');
    var qs = params.toString();
    window.location.href = qs ? '/graph?' + qs : '/graph';
  }

  function initGraphChainBadges() {
    var svg = document.getElementById('graph-svg');
    if (!svg) return;
    svg.addEventListener('click', function (ev) {
      var chainBadge = ev.target.closest ? ev.target.closest('.graph-node-chain') : null;
      if (chainBadge) {
        var expandShortId = chainBadge.getAttribute('data-batch-short-id');
        if (expandShortId) withExpandParam(expandShortId, true);
        return;
      }
      var recollapseBadge = ev.target.closest ? ev.target.closest('.graph-node-recollapse') : null;
      if (recollapseBadge) {
        var collapseShortId = recollapseBadge.getAttribute('data-batch-short-id');
        if (collapseShortId) withExpandParam(collapseShortId, false);
      }
    });
  }

  // --- Graph right-click context menu ---
  function initGraphContextMenu() {
    const svg = document.getElementById('graph-svg');
    const menu = document.getElementById('graph-context-menu');
    if (!svg || !menu) return;

    function closeMenu() {
      menu.classList.add('hidden');
      menu.innerHTML = '';
    }

    function addItem(label, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'graph-context-menu-item';
      btn.textContent = label;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        onClick(btn);
      });
      menu.appendChild(btn);
    }

    svg.addEventListener('contextmenu', function (ev) {
      const genEl = ev.target.closest ? ev.target.closest('[data-gen-short-id]') : null;
      const batchEl = !genEl && ev.target.closest ? ev.target.closest('[data-batch-short-id]') : null;
      if (!genEl && !batchEl) return;
      ev.preventDefault();

      menu.innerHTML = '';

      if (genEl) {
        const shortId = genEl.getAttribute('data-gen-short-id');
        const batchShortId = genEl.getAttribute('data-batch-short-id');
        addItem('Copy ID', function (btn) { copyText(shortId, btn); });
        addItem('Copy URL', function (btn) { copyText(window.location.origin + '/g/' + shortId, btn); });
        addItem('Open detail', function () {
          window.open(window.location.origin + '/g/' + shortId, '_blank');
          closeMenu();
        });
        const selected = genEl.classList.contains('selected');
        addItem(selected ? 'Remove from compare' : 'Add to compare', function () {
          genEl.classList.toggle('selected');
          updateCompareBar();
          closeMenu();
        });
        addItem('Show subgraph from here', function () {
          goToGraphScope('root=' + batchShortId);
        });
      } else if (batchEl) {
        const shortId = batchEl.getAttribute('data-batch-short-id');
        addItem('Copy ID', function (btn) { copyText(shortId, btn); });
        addItem('Copy URL', function (btn) { copyText(window.location.origin + '/b/' + shortId, btn); });
        addItem('Open detail', function () {
          window.open(window.location.origin + '/b/' + shortId, '_blank');
          closeMenu();
        });
        addItem('Show subgraph from here', function () {
          goToGraphScope('root=' + shortId);
        });
      }

      menu.style.left = ev.clientX + 'px';
      menu.style.top = ev.clientY + 'px';
      menu.classList.remove('hidden');
    });

    document.addEventListener('click', function () {
      closeMenu();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeMenu();
    });
    document.addEventListener('scroll', function () {
      closeMenu();
    }, true);
    svg.addEventListener('wheel', function () {
      closeMenu();
    });
  }

  // --- Story relation inline edit ---
  function initStoryRelationEdit() {
    document.addEventListener('click', function (ev) {
      const btn = ev.target.closest('.rel-edit-toggle');
      if (!btn) return;
      const targetId = btn.getAttribute('data-target');
      const form = document.getElementById(targetId);
      if (form) form.classList.toggle('hidden');
    });
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.rel-edit-form');
      if (!form) return;
      ev.preventDefault();
      const storyId = form.getAttribute('data-story-id');
      const relationId = form.getAttribute('data-relation-id');
      const label = qs('input[name="label"]', form).value;
      const description = qs('textarea[name="description"]', form).value;
      try {
        await api('/api/v1/stories/' + storyId + '/relations/' + relationId, 'PATCH', { label: label, description: description });
        const display = document.querySelector('.rel-label-display[data-relation-id="' + relationId + '"]');
        if (display) display.textContent = label || '(no label)';
        form.classList.add('hidden');
      } catch (e) {
        alert('failed to update relation: ' + e.message);
      }
    });
  }

  // --- Graph pan/zoom ---
  // During an active gesture (wheel, pinch, drag) this avoids touching the
  // SVG's viewBox: a viewBox write forces the whole SVG — including the
  // dozens of full-resolution PNG thumbnails it embeds as <image> — to
  // re-rasterize, which is what makes pan/zoom feel janky. Instead the
  // gesture only moves a CSS transform on the SVG element (GPU-composited,
  // no re-rasterization). Once the gesture goes idle the transform is folded
  // into the viewBox ("commit") and reset to identity, so viewBox stays the
  // single source of truth between gestures — initial layout, the zoom
  // buttons, persisted zoom, and graph selection/context-menu code all
  // read/write viewBox only, never the transform.
  function initGraphPanZoom() {
    var svg = document.getElementById('graph-svg');
    if (!svg) return;
    var parts = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    if (parts.length !== 4 || parts.some(function (n) { return isNaN(n); })) return;

    var vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };

    // The SVG fills its frame (100%/100%). Initial view: open at the zoom scale
    // the user last used (persisted in localStorage), defaulting to 0.7x of the
    // design size. Content is centered horizontally; if taller than the frame,
    // the newest (bottom) layer is anchored at the bottom edge.
    var ZOOM_STORE_KEY = 'chimera-graph-zoom';
    var scale = 0.7;
    try {
      var stored = parseFloat(localStorage.getItem(ZOOM_STORE_KEY) || '');
      if (stored > 0.05 && stored < 20) scale = stored;
    } catch (e) { /* localStorage unavailable */ }

    var contentW = vb.w;
    var contentH = vb.h;
    var frame = svg.getBoundingClientRect();
    if (frame.width > 0 && frame.height > 0) {
      vb.w = frame.width / scale;
      vb.h = frame.height / scale;
      vb.x = (contentW - vb.w) / 2;
      if (vb.h >= contentH) {
        vb.y = (contentH - vb.h) / 2;
      } else {
        vb.y = contentH - vb.h;
      }
    }

    var baseW = frame.width > 0 ? frame.width : vb.w;
    var minScale = 0.05;
    var maxScale = 20;

    // pending is the not-yet-committed CSS transform layered on top of
    // vb, expressed in the SVG element's own screen-space pixels: a point
    // at local (pre-transform) coordinate p renders at k*p + (tx,ty).
    // frameRect is the element's bounding rect cached while the transform
    // is identity (init, right after commit, and on resize) — it must never
    // be re-read while a gesture is live, because the CSS transform itself
    // would skew getBoundingClientRect.
    var pending = { k: 1, tx: 0, ty: 0 };
    var frameRect = frame;

    function persistScale() {
      if (frame.width <= 0) return;
      try {
        localStorage.setItem(ZOOM_STORE_KEY, String(frame.width / vb.w));
      } catch (e) { /* localStorage unavailable */ }
    }

    var initial = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    apply();

    var LABEL_SCREEN_PX = 14; // 凡例テキストと同じ見た目サイズに揃える

    function apply() {
      svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
      var rect = svg.getBoundingClientRect();
      if (rect.width > 0) {
        var fontSvg = (LABEL_SCREEN_PX * vb.w) / rect.width;
        svg.style.setProperty('--graph-edge-font', fontSvg + 'px');
        svg.style.setProperty('--graph-edge-stroke', fontSvg * 0.3 + 'px');
      }
    }

    function zoomAt(clientX, clientY, factor) {
      var rect = svg.getBoundingClientRect();
      var pointerX = vb.x + ((clientX - rect.left) / rect.width) * vb.w;
      var pointerY = vb.y + ((clientY - rect.top) / rect.height) * vb.h;
      var newW = vb.w * factor;
      var newH = vb.h * factor;
      var scale = baseW / newW;
      if (scale < minScale || scale > maxScale) return;
      vb.x = pointerX - (pointerX - vb.x) * (newW / vb.w);
      vb.y = pointerY - (pointerY - vb.y) * (newH / vb.h);
      vb.w = newW;
      vb.h = newH;
      apply();
      persistScale();
    }

    // --- transform-during-gesture / commit-on-idle plumbing ---

    var rafPending = false;
    function scheduleTransformFrame() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function () {
        rafPending = false;
        svg.style.transform = 'translate(' + pending.tx + 'px,' + pending.ty + 'px) scale(' + pending.k + ')';
      });
    }

    function beginGesture() {
      svg.style.willChange = 'transform';
    }

    function endGesture() {
      svg.style.willChange = '';
    }

    var COMMIT_DEBOUNCE_MS = 150;
    var commitTimer = null;
    function scheduleDebouncedCommit() {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(function () {
        commitTimer = null;
        commit();
      }, COMMIT_DEBOUNCE_MS);
    }
    function cancelDebouncedCommit() {
      if (commitTimer) {
        clearTimeout(commitTimer);
        commitTimer = null;
      }
    }

    // Folds the pending CSS transform into viewBox and resets it to
    // identity. A no-op (besides clearing will-change) when nothing is
    // pending, so it is safe to call unconditionally before any code path
    // that reads vb or the SVG's rendered position.
    function commit() {
      cancelDebouncedCommit();
      if (pending.k !== 1 || pending.tx !== 0 || pending.ty !== 0) {
        var oldW = vb.w;
        var oldH = vb.h;
        var k = pending.k;
        vb.w = oldW / k;
        vb.h = oldH / k;
        vb.x = vb.x - (pending.tx / k) * (oldW / frameRect.width);
        vb.y = vb.y - (pending.ty / k) * (oldH / frameRect.height);
        pending = { k: 1, tx: 0, ty: 0 };
        svg.style.transform = '';
        apply();
        frameRect = svg.getBoundingClientRect();
        persistScale();
      }
      endGesture();
    }

    // Discards the pending transform without folding it into vb — used by
    // the reset button, which replaces vb outright.
    function discardPending() {
      cancelDebouncedCommit();
      pending = { k: 1, tx: 0, ty: 0 };
      svg.style.transform = '';
      endGesture();
    }

    // A click or right-click anywhere can reach graph selection / the
    // context menu (see initGraphSelection / initGraphContextMenu), which
    // read the SVG's rendered position — so flush any in-flight gesture
    // ahead of those handlers via a capturing listener.
    document.addEventListener('contextmenu', commit, true);
    document.addEventListener('click', commit, true);

    window.addEventListener('resize', function () {
      if (pending.k === 1 && pending.tx === 0 && pending.ty === 0) {
        frameRect = svg.getBoundingClientRect();
      }
    });

    function pendingZoomAt(clientX, clientY, factor) {
      var f = 1 / factor;
      var newK = f * pending.k;
      var newScale = baseW / (vb.w / newK);
      if (newScale < minScale || newScale > maxScale) return;
      var cx = clientX - frameRect.left;
      var cy = clientY - frameRect.top;
      pending.tx = f * pending.tx + (1 - f) * cx;
      pending.ty = f * pending.ty + (1 - f) * cy;
      pending.k = newK;
      scheduleTransformFrame();
    }

    // Trackpad-first wheel handling: pinch gestures reach the browser as wheel
    // events with ctrlKey=true (Cmd+scroll opts in explicitly), so those zoom
    // around the cursor; a plain two-finger scroll pans instead of zooming.
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      beginGesture();
      if (ev.ctrlKey || ev.metaKey) {
        pendingZoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.01));
      } else {
        pending.tx -= ev.deltaX;
        pending.ty -= ev.deltaY;
        scheduleTransformFrame();
      }
      scheduleDebouncedCommit();
    }, { passive: false });

    // Safari sends pinches as gesture* events instead of ctrl+wheel.
    var gestureScale = 1;
    svg.addEventListener('gesturestart', function (ev) {
      ev.preventDefault();
      gestureScale = ev.scale;
      beginGesture();
    });
    svg.addEventListener('gesturechange', function (ev) {
      ev.preventDefault();
      if (!ev.scale) return;
      pendingZoomAt(ev.clientX, ev.clientY, gestureScale / ev.scale);
      gestureScale = ev.scale;
      scheduleDebouncedCommit();
    });
    svg.addEventListener('gestureend', function (ev) {
      ev.preventDefault();
      commit();
    });

    var controls = document.getElementById('graph-zoom-controls');
    if (controls) {
      controls.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-zoom]') : null;
        if (!btn) return;
        var action = btn.getAttribute('data-zoom');
        if (action === 'reset') {
          discardPending();
          vb.x = initial.x; vb.y = initial.y; vb.w = initial.w; vb.h = initial.h;
          persistScale();
          apply();
          frameRect = svg.getBoundingClientRect();
          return;
        }
        commit();
        var rect = svg.getBoundingClientRect();
        if (action === 'in') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
        else if (action === 'out') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
      });
    }

    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    svg.addEventListener('mousedown', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('a')) return;
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      svg.classList.add('dragging');
      beginGesture();
    });
    window.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      pending.tx += ev.clientX - lastX;
      pending.ty += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      scheduleTransformFrame();
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      svg.classList.remove('dragging');
      commit();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initRating();
    initBookmark();
    initThumbPreview();
    initTagAdd();
    initTagRemove();
    initTagSuggestions();
    initNoteForm();
    initCompareBar();
    initStoryRelationEdit();
    initGraphScope();
    initGraphPanZoom();
    initGraphSelection();
    initGraphStubs();
    initGraphChainBadges();
    initGraphContextMenu();
    initCopyIdButtons();
    initCompareCols();
    initExperimentStatus();
  });
})();
`;

// content hash (FNV-1a) — アセット URL の ?v= に使い、デプロイごとに
// ブラウザキャッシュを確実に破棄する
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
export const assetVersion = fnv1a(styleCss + appJs);
