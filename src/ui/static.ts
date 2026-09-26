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
  --graph-experiment: #c77dff;
  --nav-h: 3.25rem;
  --compare-bar-h: 3.75rem;
  --thumb-ar: 2 / 3;
  /* 透過/余白を判別するための市松（img 自体は変更しない） */
  --checker:
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%) 0 0 / 16px 16px,
    #1a1a1a linear-gradient(45deg, #2a2a2a 25%, transparent 25%, transparent 75%, #2a2a2a 75%) 8px 8px / 16px 16px;
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
.nav a[aria-current="page"],
.nav-more summary[aria-current="page"] {
  text-decoration: underline;
  text-decoration-color: var(--accent);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.45rem;
}

.nav-more { position: relative; }
.nav-more summary {
  color: var(--text);
  font-weight: 600;
  list-style: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.nav-more summary::-webkit-details-marker { display: none; }
.nav-more summary::after {
  content: '';
  width: 0.4rem;
  height: 0.4rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  margin-top: -0.2rem;
}
.nav-more-panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 0.3rem;
}
.nav-more-panel a { padding: 0.5rem 0.6rem; border-radius: 5px; }
.nav-more-panel a:hover { background: var(--bg); text-decoration: none; }

.nav-queue { margin-left: auto; position: relative; }
.nav-queue-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  height: 1.75rem;
  padding: 0 0.625rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  list-style: none;
  cursor: pointer;
}
.nav-queue-pill::-webkit-details-marker { display: none; }
.nav-queue-text { display: inline-flex; align-items: center; gap: 0.4375rem; }
.nav-queue-text:empty { display: none; }
.nav-queue-pill.nav-queue-empty { padding: 0 0.5625rem; }
.nav-queue[open] .nav-queue-pill { border-color: var(--accent); }
.nav-queue-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--text-dim); flex: none; }
.nav-queue-dot.online { background: var(--good); }
.nav-queue-dot.warn { background: var(--neutral); }
.nav-queue-sep { color: var(--text-dim); font-weight: 400; }
.nav-queue-running { color: var(--neutral); }
.nav-queue-queued { color: var(--accent); }
.nav-queue-failed { color: var(--bad); }
.nav-queue-offline { color: var(--text-dim); }

.nav-queue-panel {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: 380px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 0.3rem;
}
.nav-queue-empty-panel { padding: 0.6rem; font-size: 0.85rem; color: var(--text-dim); }
.nav-queue-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.6rem;
  border-radius: 5px;
  font-size: 0.85rem;
  color: var(--text);
}
a.nav-queue-row:hover { background: var(--bg); text-decoration: none; }
.nav-queue-row-thumb { width: 28px; height: 42px; border-radius: 3px; flex: none; background: var(--checker); border: 1px solid var(--border); overflow: hidden; }
.nav-queue-row-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.nav-queue-row-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nav-queue-row-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
.nav-queue-row-kinds { font-size: 0.75rem; color: var(--text-dim); }
.nav-queue-row-counts { margin-left: auto; display: inline-flex; gap: 0.5rem; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
.nav-queue-divider { border-top: 1px solid var(--border); margin: 0.25rem 0; }
.nav-queue-foot { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem 0.375rem; font-size: 0.75rem; color: var(--text-dim); }

@media (max-width: 600px) {
  .nav {
    padding: 0 1rem;
    gap: 1.25rem;
  }
  .nav > a,
  .nav-more > summary {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
  }
  .nav-queue-label,
  .nav-queue-sep {
    display: none;
  }
  .nav-queue-panel {
    width: calc(100vw - 2rem);
  }
}

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
/* Gallery / Bookmarks は 1 行 6 枚。Batch Detail は左ペインが狭いので auto-fill のまま */
.grid.grid-gallery { grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 1100px) {
  .grid.grid-gallery { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 800px) {
  .grid.grid-gallery { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
}

.card {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.card .thumb-link { display: block; position: relative; aspect-ratio: var(--thumb-ar); overflow: hidden; background: var(--checker); }
.card .thumb-link img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.card .thumb-link .thumb-fg { object-fit: contain; }
.card-row { padding: 0.4rem 0.55rem 0.5rem; display: flex; flex-direction: column; gap: 0.3rem; }
.card-id-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }

/* position は .thumb-link 内でのみ絶対配置 (docs/ui.md「Gallery」) */
.card-from-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: #402e21;
  color: var(--graph-relation);
}
.card-from-badge-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card-from-badge-link { text-decoration: none; }
.card-from-badge-link:hover { text-decoration: none; opacity: 0.85; }

/* from-badge が無ければ finalize ピルのみがこの位置に来る (docs/ui.md「Gallery」) */
.card .thumb-link .thumb-badges-top {
  position: absolute;
  top: 0.4rem;
  left: 0.4rem;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  max-width: calc(100% - 0.8rem);
}

/* request-status-* は .request-status-list と共通の色クラス（本ファイル下方） */
.card-finalize-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(18, 18, 20, 0.86);
  border: 1px solid var(--border);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-finalize-result { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.card .thumb-link .thumb-badges-bottom {
  position: absolute;
  bottom: 0.4rem;
  left: 0.4rem;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  max-width: calc(100% - 0.8rem);
}

.card-published-pill,
.card-reference-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(18, 18, 20, 0.86);
  border: 1px solid var(--border);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-published-pill { color: #4fd8a4; }
.card-reference-pill { color: #b39bf5; }

.pose-reference-row { margin: 0.5rem 0; }
.pose-reference-btn {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.8rem;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

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
/* 親が height:auto だと max-height:100% が効かないため viewport 基準で上限を課す。26px = margin 8px×2 + padding 4px×2 + border 1px×2 */
#thumb-preview img { display: block; max-width: calc(100vw - 26px); max-height: calc(100vh - 26px); border-radius: 6px; background: var(--checker); }
#thumb-preview.visible { display: block; }
.card-top-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.short-id-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: var(--text); }

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
/* ID 文字そのものがコピー操作（copy-id-btn とは別）。コピー後は文字を置き換えず色と ✓ で知らせる */
.copy-id-text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); padding: 0; cursor: copy; }
.copy-id-text:hover { color: var(--accent); }
.copy-id-text.copied { color: var(--good); }
.copy-id-text.copied::after { content: ' ✓'; }
.card-id { font-size: 0.78rem; }

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
.rel-badge.rel-experiment { background: color-mix(in srgb, var(--graph-experiment) 22%, transparent); color: var(--graph-experiment); }

/* FamilyCard: GenerationCard/.card より軽量で横並びに畳められる */
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
.family-card-thumb { flex: none; width: 44px; height: 44px; border-radius: 6px; overflow: hidden; background: var(--checker); }
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

.publication-status { color: var(--text-dim); font-size: 0.85rem; display: flex; align-items: center; gap: 0.3rem; margin: 0 0 0.5rem; }
.publication-status.published { color: #4fd8a4; }
.publication-list { list-style: none; margin: 0 0 0.6rem; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
.publication-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; flex-wrap: wrap; }
.publication-time { color: var(--text-dim); font-size: 0.75rem; white-space: nowrap; }
.publication-nourl { color: var(--text-dim); }
.publication-url-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.15rem 0.4rem;
  font-size: 0.75rem;
  flex: 1;
  min-width: 8rem;
}
.publication-remove-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0; font-size: 0.85rem; margin-left: auto; }
.publication-add-form { display: flex; gap: 0.4rem; }
.publication-add-form input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.2rem 0.4rem;
  font-size: 0.75rem;
  flex: 1;
}
.publication-add-btn {
  background: none;
  border: 1px solid #4fd8a4;
  color: #4fd8a4;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
}

/* sessionStorage の compare set をトグルする (docs/ui.md「Compare entry」) */
.compare-add-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.compare-add-btn.active { border-color: var(--accent); color: var(--accent); }

/* 固定配置のバーが main 末尾を隠さないよう余白を足す */
.compare-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--compare-bar-h);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  padding: 0 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  z-index: 20;
}
.compare-bar.hidden { display: none; }
body:has(#compare-bar:not(.hidden)) main { padding-bottom: calc(1.25rem + var(--compare-bar-h)); }
.compare-chips { flex: 1; min-width: 0; display: flex; gap: 0.4rem; overflow-x: auto; }
.compare-chip {
  position: relative;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--checker);
  cursor: pointer;
}
.compare-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.compare-chip-x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: rgba(8, 8, 10, 0.8);
  color: var(--text);
  font-size: 0.75rem;
  line-height: 1rem;
  text-align: center;
}
.compare-chip:hover { border-color: var(--bad); }
.compare-chip:hover .compare-chip-x { background: var(--bad); }
/* 先頭 9 件だけが /compare に渡る */
.compare-chip-overflow { opacity: 0.4; }
.compare-clear {
  flex: none;
  min-height: 2.75rem;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 0 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.compare-clear:hover { color: var(--text); }
.compare-bar a.compare-go {
  flex: none;
  display: flex;
  align-items: center;
  min-height: 2.75rem;
  background: var(--accent);
  color: #10131c;
  border-radius: 6px;
  padding: 0 0.9rem;
  font-weight: 600;
  white-space: nowrap;
}
@media (max-width: 600px) {
  .compare-bar { padding: 0 0.75rem; gap: 0.5rem; }
}

.gallery-toolbar {
  position: sticky;
  top: var(--nav-h);
  z-index: 9;
  background: var(--bg);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 0;
  margin-bottom: 1rem;
}

.view-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}
.view-switch-item {
  padding: 0.35rem 0.85rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-dim);
}
.view-switch-item:hover { text-decoration: none; }
.view-switch-item[aria-current="true"] { background: var(--bg); color: var(--text); }

.bad-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.85rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.7rem;
}
.bad-toggle:hover { text-decoration: none; color: var(--text); }
.bad-toggle-box {
  width: 0.9rem;
  height: 0.9rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg);
  display: inline-block;
}
.bad-toggle[aria-pressed="true"] .bad-toggle-box { background: var(--accent); border-color: var(--accent); }

.filter-panel { position: relative; }
.filter-panel summary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  list-style: none;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  color: var(--text);
}
.filter-panel summary::-webkit-details-marker { display: none; }
.filter-panel[open] summary { border-color: var(--accent); color: var(--accent); }
.filter-panel .filter-form {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 20;
  min-width: 260px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.filter-form textarea[name="ids"] {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  font-size: 0.8rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
  min-height: 2rem;
}

/* 帯はグリッド直前、ピルは帯がスクロールアウトしている間だけ sticky ツールバー直下に浮かぶ (docs/ui.md「Gallery pending changes」) */
.gallery-pending-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 2.75rem;
  margin-bottom: 0.75rem;
  background: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.gallery-pending-strip:hover { background: var(--bg-elevated); border-color: var(--accent); }
.gallery-pending-strip.hidden { display: none; }
.card.card-pending-hide { opacity: 0.4; }
.card.card-pending-hide:hover { opacity: 0.75; }
.gallery-pending-pill {
  position: fixed;
  top: calc(var(--nav-h) + 0.6rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 999px;
  padding: 0.4rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.gallery-pending-pill { white-space: nowrap; }
.gallery-pending-pill.hidden { display: none; }
@media (max-width: 600px) {
  .gallery-pending-pill { min-height: 2.75rem; }
}

.load-more {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 0.85rem;
}
.load-more:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }

@media (max-width: 600px) {
  .gallery-toolbar .view-switch { flex: 1 1 100%; }
  .view-switch-item { flex: 1; min-height: 2.75rem; display: flex; align-items: center; justify-content: center; }
  .bad-toggle, .filter-panel summary { min-height: 2.75rem; }

  .card .card-bookmark-btn {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    width: 2.75rem;
    height: 2.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(18, 18, 20, 0.72);
    border-radius: 999px;
    z-index: 2;
  }
  .card-row .rate-btn { flex: 1; min-height: 2.75rem; display: flex; align-items: center; justify-content: center; }
  .card-row .card-id { min-height: 2.75rem; }
}

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

.workflow-pass { border-left: 2px solid var(--border); padding-left: 0.6rem; margin: 0.6rem 0; }
.workflow-pass-head { font-weight: 600; }
.workflow-line { color: var(--text-dim); font-size: 0.85rem; }

.gen-detail-hero { text-align: center; margin-bottom: 1rem; position: relative; }
.gen-detail-hero img { max-width: 100%; max-height: 70vh; border-radius: 10px; border: 1px solid var(--border); background: var(--checker); }
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
  /* hero を height:100% にすると直後の .image-meta が押し出されて見えなくなるため縦 flex にする */
  .detail-left { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
  .detail-right { overflow-y: auto; min-height: 0; }

  .detail-left .gen-detail-hero { flex: 1; min-height: 0; margin-bottom: 0; }
  .detail-left .gen-detail-hero img { max-height: 100%; max-width: 100%; object-fit: contain; }

  .detail-right { font-size: 0.85rem; }
  .detail-right h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
  .detail-right details.section { padding: 0.5rem 0.7rem; margin-bottom: 0.5rem; }

  /* compare バー表示中は main に足した余白の分だけ縮め、ページ全体をスクロールさせない */
  body:has(#compare-bar:not(.hidden)) .detail-layout {
    height: calc(100vh - var(--nav-h) - 2.5rem - var(--compare-bar-h));
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

.finalize-form, .finalize-all-form { display: flex; flex-direction: column; gap: 0.7rem; }
.finalize-form input[type="number"], .finalize-all-form input[type="number"] { width: 5rem; }
/* type="submit" に絞る: 素の button だと .dial-btn より詳細度が高く、dial/profile ボタン全部がアクセント色で塗られ選択中が見えなくなる */
.finalize-form button[type="submit"], .finalize-all-form button[type="submit"] {
  align-self: flex-start;
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
  transition: filter 0.1s, transform 0.05s, background-color 0.15s;
}
.finalize-form button[type="submit"]:hover:not(:disabled),
.finalize-all-form button[type="submit"]:hover:not(:disabled) { filter: brightness(1.12); }
.finalize-form button[type="submit"]:active:not(:disabled),
.finalize-all-form button[type="submit"]:active:not(:disabled) { filter: brightness(0.85); transform: translateY(1px) scale(0.97); }
.finalize-form button[type="submit"]:focus-visible,
.finalize-all-form button[type="submit"]:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.finalize-form button[type="submit"]:disabled,
.finalize-all-form button[type="submit"]:disabled { opacity: 0.6; cursor: progress; }
.finalize-form button[type="submit"].is-sent,
.finalize-all-form button[type="submit"].is-sent { background: var(--good); opacity: 1; cursor: default; }
.finalize-form select, .finalize-all-form select,
.finalize-form input[name="backdrop_color"], .finalize-all-form input[name="backdrop_color"] {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  font-size: 0.85rem;
}
.finalize-form input[name="backdrop_color"], .finalize-all-form input[name="backdrop_color"] { width: 6.5rem; }
.finalize-form input:disabled, .finalize-all-form input:disabled { opacity: 0.5; cursor: not-allowed; }
.finalize-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 0.8rem 0.8rem;
  margin: 0;
  /* 吹き出しの位置基準。マーカー基準だと右ペインの overflow-y: auto で横もクリップされ、右寄りのマーカーで切れる */
  position: relative;
}
.finalize-group legend { padding: 0 0.3rem; font-size: 0.85rem; color: var(--text-dim); }
.finalize-help {
  display: inline-block;
  color: var(--text-dim);
  font-size: 0.75rem;
  cursor: help;
}
.finalize-help::after {
  content: attr(data-help);
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 10;
  margin-top: 0.3rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 0.8rem;
  white-space: normal;
  pointer-events: none;
}
.finalize-help:hover::after, .finalize-help:focus::after { display: block; }
.finalize-preview { margin: 0; font-size: 0.85rem; color: var(--text-dim); }
.finalize-summary { margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-dim); }

/* repair region drawing: dependency-free rectangle-drag overlay, sized in JS to match the
   rendered <img> box so percentage-based rects stay aligned across zoom/object-fit scaling. */
.repair-region-tools { display: flex; align-items: center; gap: 0.5rem; flex-basis: 100%; font-size: 0.8rem; color: var(--text-dim); }
.repair-region-clear {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 0.15rem 0.5rem;
  font-size: 0.78rem;
  cursor: pointer;
}
.repair-region-clear:hover { color: var(--text); border-color: var(--accent); }
.repair-region-toggle {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 0.15rem 0.5rem;
  font-size: 0.78rem;
  cursor: pointer;
}
.repair-region-toggle[aria-pressed="true"] { color: var(--text); border-color: var(--accent); background: rgba(124, 156, 245, 0.18); }
.repair-region-overlay { position: absolute; touch-action: none; cursor: crosshair; z-index: 1; }
/* Drawing off: clicks/scroll fall through to the image; rects stay visible and removable. */
.repair-region-overlay:not(.repair-region-drawing-on) { pointer-events: none; touch-action: auto; cursor: auto; }
.repair-region-overlay:not(.repair-region-drawing-on) .repair-region-remove { pointer-events: auto; }
.repair-region-rect {
  position: absolute;
  border: 1.5px solid var(--accent);
  background: rgba(124, 156, 245, 0.18);
  box-sizing: border-box;
}
.repair-region-rect-drawing { border-style: dashed; background: rgba(124, 156, 245, 0.1); }
.repair-region-remove {
  position: absolute;
  top: -0.6rem;
  right: -0.6rem;
  width: 1.2rem;
  height: 1.2rem;
  line-height: 1;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}
.repair-region-remove:hover { border-color: var(--bad); color: var(--bad); }

.backdrop-picker {
  flex-basis: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
  gap: 0.4rem;
}
.backdrop-picker > .dial-label { grid-column: 1 / -1; }
.backdrop-option {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  text-align: center;
}
.backdrop-option input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
.backdrop-option:hover { border-color: var(--accent); }
.backdrop-option:has(input:checked) {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.backdrop-option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.backdrop-option:has(input:checked) .backdrop-option-label { color: var(--text); }
.backdrop-option-plain { grid-column: span 2; align-self: start; justify-content: center; padding: 0.45rem 0.25rem; }
.backdrop-option-plain[data-backdrop-value="transparent"] { grid-column: 1 / span 2; }
.backdrop-thumb { display: block; width: 100%; height: auto; aspect-ratio: 5 / 8; object-fit: cover; border-radius: 4px; }
.backdrop-option-label { font-size: 0.7rem; color: var(--text-dim); line-height: 1.25; }

.dial-group, .profile-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
.dial-label { font-size: 0.8rem; color: var(--text-dim); margin-right: 0.2rem; }
.dial-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.dial-btn:hover:not(.dial-btn-active) { border-color: var(--accent); }
.dial-btn:active { transform: scale(0.96); }
.dial-btn-active { background: var(--accent); color: #10131c; border-color: var(--accent); }
.promote-profile-form { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem; }
.promote-profile-status { font-size: 0.8rem; color: var(--text-dim); }

.request-status-list { list-style: none; margin: 0.6rem 0 0; padding: 0; font-size: 0.85rem; }
.request-status-queued { color: var(--accent); }
.request-status-running { color: var(--neutral); }
.request-status-done { color: var(--good); }
.request-status-failed { color: var(--bad); }
.request-status-cancelled { color: var(--text-dim); }
.request-progress { color: var(--text-dim); margin-left: 0.4rem; font-variant-numeric: tabular-nums; }

.style-check-render-btn {
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-weight: 600;
  cursor: pointer;
}
.style-check-render-btn:disabled { opacity: 0.6; cursor: default; }
.style-check-row { margin: 1.5rem 0; padding-top: 1.25rem; border-top: 1px solid var(--border); }
.style-check-row-title { margin-bottom: 0.6rem; }
.style-check-row-pose { color: var(--text-dim); font-weight: 400; font-size: 0.85em; }
.style-check-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 260px)); gap: 1rem; }
.style-check-cell h3 { margin: 0 0 0.4rem; font-size: 0.85rem; color: var(--text-dim); font-weight: 600; }
.style-check-cell .card { max-width: 260px; }

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
.batch-row img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; background: var(--checker); }
.batch-row .batch-meta { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
.batch-row .instruction-excerpt { color: var(--text-dim); font-size: 0.8rem; }

.hidden { display: none !important; }

.compare-cols-picker { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.75rem; font-size: 0.8rem; color: var(--text-dim); }
.compare-cols-picker select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  font-size: 0.8rem;
}
/* auto-fill で列幅を全行共通に（flex-wrap だと折り返し後の行だけ伸びる）。列数指定時は
   initCompareCols が grid-template-columns をインラインで上書きする */
.compare-columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 320px)); gap: 1rem; }

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
.exp-run-thumb img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; background: var(--checker); }
.exp-run-batch-link { font-size: 0.82rem; }

.exp-base-generation { display: inline-flex; align-items: center; gap: 0.5rem; }
.exp-base-generation-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; background: var(--checker); }

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

.exp-run-ab-link { margin-left: 0.6rem; font-size: 0.8rem; }

.exp-ab-pairs, .exp-ab-ratings { margin-top: 0.6rem; margin-bottom: 1.5rem; }
.exp-ab-pairs th, .exp-ab-ratings th {
  text-align: left;
  padding: 0.2rem 0.8rem 0.2rem 0;
  font-size: 0.78rem;
  color: var(--text-dim);
  font-weight: 600;
}
.exp-ab-pairs td, .exp-ab-ratings td { padding: 0.2rem 0.8rem 0.2rem 0; font-size: 0.85rem; }

.ab-warning { color: var(--bad); font-weight: 600; }
.ab-subtitle { color: var(--text-dim); }
.ab-progress { font-weight: 600; }
.ab-seed { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 0.5rem; }
.ab-hint { color: var(--text-dim); font-size: 0.78rem; margin-top: 0.75rem; text-align: center; }
.ab-done { font-weight: 600; }

.ab-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.ab-side {
  position: relative;
  display: block;
}
.ab-side img {
  display: block;
  width: 100%;
  height: auto;
  max-height: calc(100vh - 12rem);
  object-fit: contain;
  background: var(--checker);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.ab-side-label {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.1rem 0.5rem;
  font-weight: 600;
  font-size: 0.85rem;
}

.ab-votes {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.25rem;
}
.ab-vote {
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 1.1rem;
  padding: 0.7rem 2rem;
  font-weight: 600;
  cursor: pointer;
}
.ab-vote:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ab-vote:disabled { opacity: 0.5; cursor: default; }

.ab-reveal {
  margin-top: 1.25rem;
  text-align: center;
}
.ab-reveal-line { color: var(--text); font-size: 0.9rem; margin-bottom: 0.75rem; }
.ab-next {
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  padding: 0.6rem 2.2rem;
  font-weight: 600;
  cursor: pointer;
}

.exp-facts { margin-bottom: 0.4rem; }
.exp-facts th { text-align: left; padding: 0.2rem 0.8rem 0.2rem 0; font-size: 0.78rem; color: var(--text-dim); font-weight: 600; }
.exp-facts td { padding: 0.2rem 0.8rem 0.2rem 0; font-size: 0.85rem; }
.exp-facts-diff { background: rgba(124, 156, 245, 0.18); }
.exp-facts-legend { color: var(--text-dim); font-size: 0.78rem; margin-bottom: 1rem; }
.exp-facts-patches td { color: var(--text-dim); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }

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
      const err = new Error(message || ('request failed: ' + res.status));
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.indexOf('application/json') !== -1 ? res.json() : null;
  }

  // docs/ui.md「Telemetry」。posthog 未初期化時は no-op。呼び出し元の多くが capture 直後に
  // reload/遷移するため、バッチに乗せず即時 beacon で送る。
  function track(event, props) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(event, props || {}, { transport: 'sendBeacon', send_instantly: true });
      }
    } catch (e) {}
  }
  function trackError(action, e, props) {
    track('ui.error', Object.assign({ action: action, message: e && e.message ? e.message : String(e), status: e && e.status ? e.status : null }, props || {}));
  }

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

  // 連続コピー時に前回のタイマーが ✓ を早く消さないよう、ボタンごとに保持する
  var copyIdTextTimers = new WeakMap();

  function initCopyIdButtons() {
    document.addEventListener('click', function (ev) {
      const btn = ev.target.closest('.copy-id-btn');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const value = btn.getAttribute('data-copy-id');
      if (!value) return;
      if (!btn.classList.contains('copy-id-text')) {
        copyText(value, btn, '✓');
        return;
      }
      try {
        navigator.clipboard.writeText(value).then(function () {
          clearTimeout(copyIdTextTimers.get(btn));
          btn.classList.add('copied');
          copyIdTextTimers.set(btn, setTimeout(function () { btn.classList.remove('copied'); }, 900));
        }).catch(function () {});
      } catch (e) {}
    });
  }

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

  // data-generation-id が一致する全要素に反映する（同じ Generation の rating-group が複数あっても揃える）
  function applyRatingToGroups(id, rating) {
    qsa('.rating-group[data-generation-id="' + id + '"]').forEach(function (group) {
      group.setAttribute('data-current', rating || '');
      qsa('.rate-btn', group).forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-rating') === rating);
      });
    });
  }

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
        applyRatingToGroups(id, next);
        track('rating.set', { generation_id: id, rating: next, previous: current || null });
        markGalleryPendingBad(id, next === 'bad');
      } catch (e) {
        trackError('rating.set', e, { generation_id: id });
        alert('rating update failed: ' + e.message);
      }
    });
  }

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
        track('bookmark.toggle', { kind: kind, id: id, bookmarked: !bookmarked });
      } catch (e) {
        trackError('bookmark.toggle', e, { kind: kind, id: id });
        alert('bookmark update failed: ' + e.message);
      }
    });
  }

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
        track('experiment.status', { experiment_id: id, from: previous, to: next });
        location.reload();
      } catch (e) {
        trackError('experiment.status', e, { experiment_id: id, from: previous, to: next });
        alert('status update failed: ' + e.message);
        select.value = previous;
      }
    });
  }

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
        track('tag.add', { kind: kind, id: id, tag: tag.name });
      } catch (e) {
        trackError('tag.add', e, { kind: kind, id: id });
        alert('failed to add tag: ' + e.message);
      }
    });
  }

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
        track('tag.remove', { kind: kind, id: id, tag_id: tagId });
      } catch (e) {
        trackError('tag.remove', e, { kind: kind, id: id, tag_id: tagId });
        alert('failed to remove tag: ' + e.message);
      }
    });
  }

  function initTagSuggestions() {
    let debounceTimer = null;
    let abortController = null;
    document.addEventListener('input', async function (ev) {
      const input = ev.target.closest('.tag-add-form input[name="name"]');
      if (!input) return;
      const q = input.value.trim();

      if (debounceTimer) clearTimeout(debounceTimer);
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
          }
        }
      }, 200);
    });
  }

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
        track('note.save', { kind: kind, id: id, length: textarea.value.length });
      } catch (e) {
        trackError('note.save', e, { kind: kind, id: id });
        if (status) status.textContent = 'failed: ' + e.message;
      }
    });
  }

  // 'MM-DD HH:mm'（UTC）。src/ui/pages/GenerationDetail.tsx の formatPublishedAt と同じ書式。
  function formatPublishedAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  // src/ui/pages/GenerationDetail.tsx の PublishIcon と同じ markup。
  var PUBLICATION_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M14 2L2 7.5L7 9L9 14L14 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path>' +
    '<path d="M14 2L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path></svg>';

  function updatePublicationStatus(section, count) {
    var status = qs('.publication-status', section);
    if (!status) return;
    status.classList.toggle('published', count > 0);
    status.innerHTML = count > 0 ? (PUBLICATION_ICON_SVG + ' 公開済み（' + count + '）') : '未公開';
  }

  function publicationRow(p) {
    var li = document.createElement('li');
    li.className = 'publication-row';
    li.setAttribute('data-publication-id', p.id);

    var time = document.createElement('span');
    time.className = 'publication-time';
    time.textContent = formatPublishedAt(p.published_at);
    li.appendChild(time);

    if (p.url) {
      var a = document.createElement('a');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = p.url;
      li.appendChild(a);
    } else {
      var noUrl = document.createElement('span');
      noUrl.className = 'publication-nourl';
      noUrl.textContent = 'URL なし';
      li.appendChild(noUrl);

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'publication-url-input';
      input.placeholder = '投稿 URL';
      li.appendChild(input);
    }

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'publication-remove-btn';
    removeBtn.textContent = '×';
    li.appendChild(removeBtn);

    return li;
  }

  function initPublicationAdd() {
    document.addEventListener('submit', async function (ev) {
      var form = ev.target.closest('.publication-add-form');
      if (!form) return;
      ev.preventDefault();
      var section = form.closest('.publication-section');
      var generationId = section ? section.getAttribute('data-generation-id') : null;
      var input = qs('input[name="url"]', form);
      var url = (input.value || '').trim();
      try {
        var publication = await api('/api/v1/generations/' + generationId + '/publications', 'POST', { url: url || null });
        var list = qs('.publication-list', section);
        if (list && !list.querySelector('[data-publication-id="' + publication.id + '"]')) {
          list.insertBefore(publicationRow(publication), list.firstChild);
        }
        updatePublicationStatus(section, list ? list.children.length : 1);
        input.value = '';
        track('publication.add', { generation_id: generationId, has_url: Boolean(url) });
      } catch (e) {
        trackError('publication.add', e, { generation_id: generationId });
        alert('failed to record publication: ' + e.message);
      }
    });
  }

  function initPublicationUrlSave() {
    document.addEventListener('change', async function (ev) {
      var input = ev.target.closest ? ev.target.closest('.publication-url-input') : null;
      if (!input) return;
      var row = input.closest('.publication-row');
      var section = input.closest('.publication-section');
      var generationId = section ? section.getAttribute('data-generation-id') : null;
      var publicationId = row ? row.getAttribute('data-publication-id') : null;
      var url = (input.value || '').trim();
      if (!url) return;
      try {
        await api('/api/v1/publications/' + publicationId, 'PATCH', { url: url });
        input.replaceWith((function () {
          var a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = url;
          return a;
        })());
        var noUrl = qs('.publication-nourl', row);
        if (noUrl) noUrl.remove();
        track('publication.url', { generation_id: generationId, has_url: true });
      } catch (e) {
        trackError('publication.url', e, { generation_id: generationId });
        alert('failed to save publication url: ' + e.message);
      }
    });
  }

  function initPublicationRemove() {
    document.addEventListener('click', async function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.publication-remove-btn') : null;
      if (!btn) return;
      var row = btn.closest('.publication-row');
      var section = btn.closest('.publication-section');
      var generationId = section ? section.getAttribute('data-generation-id') : null;
      var publicationId = row ? row.getAttribute('data-publication-id') : null;
      try {
        await api('/api/v1/publications/' + publicationId, 'DELETE');
        row.remove();
        var list = qs('.publication-list', section);
        updatePublicationStatus(section, list ? list.children.length : 0);
        track('publication.remove', { generation_id: generationId, has_url: Boolean(row.querySelector('a')) });
      } catch (e) {
        trackError('publication.remove', e, { generation_id: generationId });
        alert('failed to remove publication: ' + e.message);
      }
    });
  }

  function poseReferencePill(recipe, pose) {
    var span = document.createElement('span');
    span.className = 'card-reference-pill';
    span.title = recipe + ' の ' + pose + ' の基準 render';
    span.textContent = '基準 ' + pose;
    return span;
  }

  function initPoseReference() {
    document.addEventListener('click', async function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.pose-reference-btn') : null;
      if (!btn) return;
      var generationId = btn.getAttribute('data-generation-id');
      try {
        var result = await api('/api/v1/generations/' + generationId + '/pose-reference', 'POST', {});
        qsa('.pose-reference-row[data-generation-id="' + generationId + '"]').forEach(function (row) {
          row.innerHTML = '';
          row.appendChild(poseReferencePill(result.recipe, result.name));
        });
        track('pose_reference.set', { generation_id: generationId });
      } catch (e) {
        trackError('pose_reference.set', e, { generation_id: generationId });
        alert('failed to set pose reference: ' + e.message);
      }
    });
  }

  // dial group state lives in data-dial-mode: 'default'/'off' (no value sent), a word (sent as
  // that string), or 'custom' (read the number input).
  function dialGroupValue(form, key) {
    var group = qs('[data-dial-key="' + key + '"]', form);
    if (!group) return undefined; // no dial-group rendered for this key -> caller falls back to the plain input
    var mode = group.getAttribute('data-dial-mode') || 'default';
    if (mode === 'default' || mode === 'off') return null;
    if (mode === 'custom') {
      var input = qs('.dial-custom-input', group);
      var raw = input ? input.value : '';
      return raw === '' ? null : Number(raw);
    }
    if (group.classList.contains('dial-group-tristate') && mode === 'on') return true;
    return mode; // the word itself, e.g. 'tidy'
  }

  function setDialGroupValue(group, value) {
    var input = qs('.dial-custom-input', group);
    var isTristate = group.classList.contains('dial-group-tristate');
    var mode, buttonValue;
    if (value === null || value === undefined) {
      mode = isTristate ? 'off' : 'default';
      buttonValue = '';
    } else if (value === true) {
      mode = 'on';
      buttonValue = 'on';
    } else if (typeof value === 'string') {
      mode = value;
      buttonValue = value;
    } else {
      mode = 'custom';
      buttonValue = '__custom__';
    }
    group.setAttribute('data-dial-mode', mode);
    qsa('.dial-btn', group).forEach(function (b) {
      b.classList.toggle('dial-btn-active', b.getAttribute('data-dial-value') === buttonValue);
    });
    if (input) {
      if (mode === 'custom') {
        input.hidden = false;
        input.disabled = false;
        input.value = typeof value === 'number' ? String(value) : '';
      } else {
        input.hidden = true;
        input.disabled = true;
        input.value = '';
      }
    }
  }

  function initDialGroups() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.dial-group .dial-btn') : null;
      if (!btn) return;
      var group = btn.closest('.dial-group');
      if (!group) return;
      ev.preventDefault();
      var value = btn.getAttribute('data-dial-value');
      var input = qs('.dial-custom-input', group);
      var isTristate = group.classList.contains('dial-group-tristate');
      if (value === '__custom__') {
        group.setAttribute('data-dial-mode', 'custom');
        if (input) { input.hidden = false; input.disabled = false; input.focus(); }
      } else {
        group.setAttribute('data-dial-mode', value === '' ? (isTristate ? 'off' : 'default') : value);
        if (input) { input.hidden = true; input.disabled = true; input.value = ''; }
      }
      qsa('.dial-btn', group).forEach(function (b) { b.classList.toggle('dial-btn-active', b === btn); });
    });
  }

  // options.backdrop is null/a #RRGGBB color/a pattern name — never the literal 'transparent'/
  // 'color' radio-value strings (finalizeOptionsFrom's output, mirrored here for profile re-select).
  function applyBackdropToForm(form, value) {
    var mode;
    if (value === null || value === undefined) {
      mode = 'transparent';
    } else if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      mode = 'color';
      var color = qs('input[name="backdrop_color"]', form);
      if (color) color.value = value;
    } else if (typeof value === 'string') {
      mode = value;
    } else {
      return;
    }
    var matched = false;
    qsa('input[name="backdrop"]', form).forEach(function (r) {
      r.checked = r.value === mode;
      if (r.checked) matched = true;
    });
    if (matched) syncFinalizeBackdropColor(form);
  }

  function applyProfileOptionsToForm(form, options) {
    Object.keys(options).forEach(function (key) {
      var value = options[key];
      if (key === 'backdrop') {
        applyBackdropToForm(form, value);
        return;
      }
      var group = qs('[data-dial-key="' + key + '"]', form);
      if (group) {
        setDialGroupValue(group, value);
        return;
      }
      var plainInput = qs('input[name="' + key + '"]', form);
      if (plainInput && plainInput.type === 'number') {
        plainInput.value = (value === null || value === undefined || typeof value === 'boolean') ? '' : String(value);
        return;
      }
      if (plainInput && plainInput.type === 'checkbox') {
        plainInput.checked = value === true;
        return;
      }
      var select = qs('select[name="' + key + '"]', form);
      if (select && typeof value === 'string') select.value = value;
    });
    syncFinalizeDeliverOnly(form);
  }

  function initProfileButtons() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.profile-group .dial-btn') : null;
      if (!btn) return;
      var group = btn.closest('.profile-group');
      var form = group ? group.closest('.finalize-form, .finalize-all-form') : null;
      if (!group || !form) return;
      ev.preventDefault();
      qsa('.dial-btn', group).forEach(function (b) { b.classList.toggle('dial-btn-active', b === btn); });

      var nameInput = qs('input[name="profile_name"]', form);
      var versionInput = qs('input[name="profile_version"]', form);
      if (btn.classList.contains('profile-btn-custom')) {
        nameInput.value = '';
        versionInput.value = '';
        return;
      }
      nameInput.value = btn.getAttribute('data-profile-name') || '';
      versionInput.value = btn.getAttribute('data-profile-version') || '';

      var options = {};
      try { options = JSON.parse(btn.getAttribute('data-profile-options') || '{}'); } catch (e) { options = {}; }
      applyProfileOptionsToForm(form, options);
    });
  }

  function profileRefFrom(form) {
    var nameInput = qs('input[name="profile_name"]', form);
    if (!nameInput || !nameInput.value) return null;
    var versionInput = qs('input[name="profile_version"]', form);
    var version = versionInput && versionInput.value ? Number(versionInput.value) : undefined;
    return version === undefined ? { name: nameInput.value } : { name: nameInput.value, version: version };
  }

  // Only .finalize-form (single image) gets a region overlay; .finalize-all-form (Batch Detail,
  // no single image) is left untouched. State keyed by the form itself in a WeakMap, since a set
  // of rectangles has no single DOM home; finalizeOptionsFrom reads it back via regionsFor(form).
  var repairRegionState = new WeakMap(); // form -> { img, overlay, regions: [[x0,y0,x1,y1], ...] }

  function regionsFor(form) {
    var state = repairRegionState.get(form);
    return state ? state.regions : [];
  }

  function findFinalizeRegionImage() {
    return qs('.gen-detail-hero img');
  }

  function syncRepairRegionOverlayGeometry(state) {
    state.overlay.style.left = state.img.offsetLeft + 'px';
    state.overlay.style.top = state.img.offsetTop + 'px';
    state.overlay.style.width = state.img.offsetWidth + 'px';
    state.overlay.style.height = state.img.offsetHeight + 'px';
  }

  function repairRegionCount(form) {
    return qs('[data-repair-region-count]', form);
  }

  function repairRegionDrawingOn(form) {
    var toggle = qs('[data-repair-region-toggle]', form);
    return !!toggle && toggle.getAttribute('aria-pressed') === 'true';
  }

  function applyRepairRegionDrawingMode(form) {
    var on = repairRegionDrawingOn(form);
    var toggle = qs('[data-repair-region-toggle]', form);
    if (toggle) toggle.textContent = on ? '範囲指定 ON' : '範囲指定 OFF';
    var state = repairRegionState.get(form);
    if (state) state.overlay.classList.toggle('repair-region-drawing-on', on);
  }

  // repair pad/lora/seeds enablement depends on regions too, so re-run the same sync here
  function onRepairRegionsChanged(form) {
    var countEl = repairRegionCount(form);
    if (countEl) {
      var n = regionsFor(form).length;
      countEl.textContent = n > 0 ? '指定範囲: ' + n : '';
    }
    syncFinalizeDeliverOnly(form);
    renderFinalizePreview(form);
  }

  function addRepairRegionRect(state, form, x0, y0, x1, y1) {
    state.regions.push([x0, y0, x1, y1]);
    var rect = document.createElement('div');
    rect.className = 'repair-region-rect';
    rect.style.left = x0 * 100 + '%';
    rect.style.top = y0 * 100 + '%';
    rect.style.width = (x1 - x0) * 100 + '%';
    rect.style.height = (y1 - y0) * 100 + '%';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'repair-region-remove';
    remove.setAttribute('aria-label', '範囲を消す');
    remove.textContent = '×';
    rect.appendChild(remove);
    state.overlay.appendChild(rect);
    remove.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    remove.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var idx = qsa('.repair-region-rect', state.overlay).indexOf(rect);
      if (idx === -1) return;
      state.regions.splice(idx, 1);
      rect.remove();
      onRepairRegionsChanged(form);
    });
    onRepairRegionsChanged(form);
  }

  // Fractions are relative to the overlay box (kept pinned to the rendered <img> by
  // syncRepairRegionOverlayGeometry), matching the [x0,y0,x1,y1] convention repair/masked_redraw use server-side.
  function attachRepairRegionDrawing(state, form) {
    var overlay = state.overlay;
    var drawing = null;

    function localPoint(ev) {
      var rect = overlay.getBoundingClientRect();
      var x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
      var y = Math.min(Math.max(ev.clientY - rect.top, 0), rect.height);
      return { x: x, y: y, width: rect.width, height: rect.height };
    }

    function paintDrawingRect(x, y) {
      var left = Math.min(drawing.startX, x);
      var top = Math.min(drawing.startY, y);
      drawing.el.style.left = left + 'px';
      drawing.el.style.top = top + 'px';
      drawing.el.style.width = Math.abs(x - drawing.startX) + 'px';
      drawing.el.style.height = Math.abs(y - drawing.startY) + 'px';
      drawing.lastX = x;
      drawing.lastY = y;
    }

    overlay.addEventListener('pointerdown', function (ev) {
      if (!repairRegionDrawingOn(form)) return;
      if (ev.target !== overlay) return; // an existing rect or its remove button, not the backdrop
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      var p = localPoint(ev);
      var el = document.createElement('div');
      el.className = 'repair-region-rect repair-region-rect-drawing';
      overlay.appendChild(el);
      drawing = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, el: el };
      paintDrawingRect(p.x, p.y);
      try { overlay.setPointerCapture(ev.pointerId); } catch (e) {}
    });

    overlay.addEventListener('pointermove', function (ev) {
      if (!drawing) return;
      var p = localPoint(ev);
      paintDrawingRect(p.x, p.y);
    });

    function finishDrawing(ev) {
      if (!drawing) return;
      var el = drawing.el;
      var rect = overlay.getBoundingClientRect();
      var x0 = Math.min(drawing.startX, drawing.lastX);
      var y0 = Math.min(drawing.startY, drawing.lastY);
      var x1 = Math.max(drawing.startX, drawing.lastX);
      var y1 = Math.max(drawing.startY, drawing.lastY);
      el.remove();
      drawing = null;
      if (ev) { try { overlay.releasePointerCapture(ev.pointerId); } catch (e) {} }
      if (x1 - x0 < 4 || y1 - y0 < 4 || rect.width <= 0 || rect.height <= 0) return; // a stray click/tap, not a drag
      var x0f = Math.round((x0 / rect.width) * 10000) / 10000;
      var y0f = Math.round((y0 / rect.height) * 10000) / 10000;
      var x1f = Math.round((x1 / rect.width) * 10000) / 10000;
      var y1f = Math.round((y1 / rect.height) * 10000) / 10000;
      if (x1f <= x0f || y1f <= y0f) return;
      addRepairRegionRect(state, form, x0f, y0f, x1f, y1f);
    }

    overlay.addEventListener('pointerup', finishDrawing);
    overlay.addEventListener('pointercancel', function () {
      if (drawing) { drawing.el.remove(); drawing = null; }
    });

    state.clear = function () {
      qsa('.repair-region-rect', overlay).forEach(function (el) { el.remove(); });
      state.regions.length = 0;
      onRepairRegionsChanged(form);
    };
  }

  // Idempotent: safe to call again on the same form (Generation Detail's DOMContentLoaded pass).
  function ensureRepairRegionOverlay(form) {
    if (!qs('[data-repair-region-tools]', form)) return null; // FinalizeFields rendered without regionDrawing
    var img = findFinalizeRegionImage();
    var existing = repairRegionState.get(form);
    if (existing && existing.img === img && existing.overlay.isConnected) return existing;
    if (!img) {
      if (existing) existing.overlay.remove();
      repairRegionState.delete(form);
      return null;
    }

    var parent = img.parentElement;
    var stale = qs('.repair-region-overlay', parent);
    if (stale) stale.remove();

    var overlay = document.createElement('div');
    overlay.className = 'repair-region-overlay';
    parent.insertBefore(overlay, img.nextSibling);

    var state = { img: img, overlay: overlay, regions: [] };
    syncRepairRegionOverlayGeometry(state);
    attachRepairRegionDrawing(state, form);
    repairRegionState.set(form, state);
    applyRepairRegionDrawingMode(form);

    var resync = function () { syncRepairRegionOverlayGeometry(state); };
    img.addEventListener('load', resync);
    window.addEventListener('resize', resync);
    if (window.ResizeObserver) new ResizeObserver(resync).observe(img);

    onRepairRegionsChanged(form);
    return state;
  }

  function initFinalizeRepairRegions() {
    qsa('.finalize-form').forEach(ensureRepairRegionOverlay);
    document.addEventListener('click', function (ev) {
      var toggle = ev.target.closest ? ev.target.closest('[data-repair-region-toggle]') : null;
      if (!toggle) return;
      var form = toggle.closest('.finalize-form');
      if (!form) return;
      toggle.setAttribute('aria-pressed', repairRegionDrawingOn(form) ? 'false' : 'true');
      applyRepairRegionDrawingMode(form);
    });
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-repair-region-clear]') : null;
      if (!btn) return;
      var form = btn.closest('.finalize-form');
      if (!form) return;
      var state = repairRegionState.get(form);
      if (state && state.clear) state.clear();
    });
  }

  // worker-protocol.md: GUI queues finalize only. Returns null when the form can't become
  // options; quiet mode (used by the preview) silences the alert on a malformed backdrop colour.
  function finalizeOptionsFrom(form, quiet) {
    var recolor = qs('input[name="recolor"]', form);
    var backdropChecked = qs('input[name="backdrop"]:checked', form);
    var backdropMode = backdropChecked ? backdropChecked.value : 'stripes';
    var backdrop = backdropMode === 'transparent' ? null : backdropMode;
    if (backdropMode === 'color') {
      backdrop = qs('input[name="backdrop_color"]', form).value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(backdrop)) {
        if (!quiet) alert('backdrop color must be #RRGGBB');
        return null;
      }
    }
    var strokeLight = qs('select[name="stroke_light"]', form).value;

    var deliverOnlyBox = qs('input[name="deliver_only"]', form);
    var deliverOnly = !!(deliverOnlyBox && deliverOnlyBox.checked);

    var keepLegwearFromDial = dialGroupValue(form, 'keep_legwear');
    var keepLegwear = keepLegwearFromDial === undefined
      ? (qs('input[name="keep_legwear"]', form).checked ? true : null)
      : keepLegwearFromDial;

    var options = {
      repin: qs('input[name="repin"]', form).checked,
      recolor: recolor ? recolor.checked : false,
      keep_legwear: keepLegwear,
      backdrop: backdrop,
      stroke_light: strokeLight === 'none' ? null : strokeLight,
    };

    // repair (hands/feet + regions) applies in both deliver_only and redraw mode; only
    // denoise/repair_lora/repair_seeds differ by mode. A checked part with zero regions is fine
    // (the worker auto-detects); nothing checked and no regions omits every repair* key.
    var repair = [];
    if (qs('input[name="repair_hands"]', form).checked) repair.push('hands');
    if (qs('input[name="repair_feet"]', form).checked) repair.push('feet');
    var regions = regionsFor(form);
    var repairActive = repair.length > 0 || regions.length > 0;

    // Drawn rectangles replace detection: DWPose circles added on top of a rectangle widen the mask
    // past the part and the reroll's palette seams show along the circle.
    if (regions.length > 0) repair = [];
    if (repairActive) {
      options.repair = repair;
      if (regions.length > 0) options.repair_regions = regions;
    }
    var repairPadRaw = qs('input[name="repair_pad"]', form).value;
    if (repair.length > 0 && repairPadRaw !== '') options.repair_pad = Number(repairPadRaw);

    if (deliverOnly) {
      options.deliver_only = true;
      if (repairActive) {
        var repairSeedsRaw = qs('input[name="repair_seeds"]', form).value;
        if (repairSeedsRaw !== '') options.repair_seeds = Number(repairSeedsRaw);
      }
      return options;
    }

    var denoiseFromDial = dialGroupValue(form, 'denoise');
    var denoise;
    if (denoiseFromDial === undefined) {
      var denoiseRaw = qs('input[name="denoise"]', form).value;
      denoise = denoiseRaw === '' ? null : Number(denoiseRaw);
    } else {
      denoise = denoiseFromDial;
    }
    options.denoise = denoise;

    var repairLoraFromDial = dialGroupValue(form, 'repair_lora');
    var repairLora;
    if (repairLoraFromDial === undefined) {
      var repairLoraRaw = qs('input[name="repair_lora"]', form).value;
      repairLora = repairLoraRaw === '' ? null : Number(repairLoraRaw);
    } else {
      repairLora = repairLoraFromDial;
    }
    if (repair.length > 0 && repairLora !== null) options.repair_lora = repairLora;

    return options;
  }

  // The color input stays disabled while hidden so the browser's pattern check
  // cannot block submit on a control it has no way to show.
  function syncFinalizeBackdropColor(form) {
    var checked = qs('input[name="backdrop"]:checked', form);
    var color = qs('input[name="backdrop_color"]', form);
    var on = !!checked && checked.value === 'color';
    color.hidden = !on;
    color.disabled = !on;
  }

  function initFinalizeBackdropColor() {
    qsa('.finalize-form, .finalize-all-form').forEach(syncFinalizeBackdropColor);
    document.addEventListener('change', function (ev) {
      var radio = ev.target;
      if (!(radio instanceof HTMLInputElement) || radio.type !== 'radio' || radio.name !== 'backdrop') return;
      var form = radio.closest('.finalize-form, .finalize-all-form');
      if (!form) return;
      syncFinalizeBackdropColor(form);
      if (radio.value === 'color') qs('input[name="backdrop_color"]', form).focus();
    });
  }

  // denoise/keep_legwear/repair_lora are gated purely by deliver_only; repair_pad/repair_lora also
  // by repairActive (a checked part or drawn region); repair_seeds needs both, since it's meaningless
  // in redraw mode. initFinalizeRepairPad and initFinalizeDeliverOnly both funnel into this one sync
  // so the three triggers (deliver_only, repair_hands/feet, region drawn/removed) stay in agreement.
  function syncFinalizeDeliverOnly(form) {
    var box = qs('input[name="deliver_only"]', form);
    var deliverOnly = !!(box && box.checked);

    var denoiseGroup = qs('[data-dial-key="denoise"]', form);
    if (denoiseGroup) {
      qsa('.dial-btn', denoiseGroup).forEach(function (b) { b.disabled = deliverOnly; });
      var denoiseCustom = qs('.dial-custom-input', denoiseGroup);
      if (denoiseCustom && (deliverOnly || !denoiseCustom.hidden)) denoiseCustom.disabled = deliverOnly;
    } else {
      qs('input[name="denoise"]', form).disabled = deliverOnly;
    }

    var keepLegwearGroup = qs('[data-dial-key="keep_legwear"]', form);
    if (keepLegwearGroup) {
      qsa('.dial-btn', keepLegwearGroup).forEach(function (b) { b.disabled = deliverOnly; });
      var keepLegwearCustom = qs('.dial-custom-input', keepLegwearGroup);
      if (keepLegwearCustom && (deliverOnly || !keepLegwearCustom.hidden)) keepLegwearCustom.disabled = deliverOnly;
    } else {
      var keepLegwearBox = qs('input[name="keep_legwear"]', form);
      if (keepLegwearBox) keepLegwearBox.disabled = deliverOnly;
    }

    var hands = qs('input[name="repair_hands"]', form);
    var feet = qs('input[name="repair_feet"]', form);
    var repairPartChecked = !!((hands && hands.checked) || (feet && feet.checked));
    var repairActive = repairPartChecked || regionsFor(form).length > 0;

    var pad = qs('input[name="repair_pad"]', form);
    if (pad) pad.disabled = !repairPartChecked;

    var loraDisabled = deliverOnly || !repairPartChecked;
    var loraGroup = qs('[data-dial-key="repair_lora"]', form);
    if (loraGroup) {
      qsa('.dial-btn', loraGroup).forEach(function (b) { b.disabled = loraDisabled; });
      var loraCustom = qs('.dial-custom-input', loraGroup);
      if (loraCustom && (loraDisabled || !loraCustom.hidden)) loraCustom.disabled = loraDisabled;
    } else {
      var loraInput = qs('input[name="repair_lora"]', form);
      if (loraInput) loraInput.disabled = loraDisabled;
    }

    var seeds = qs('input[name="repair_seeds"]', form);
    if (seeds) seeds.disabled = !(deliverOnly && repairActive);
  }

  function initFinalizeRepairPad() {
    document.addEventListener('change', function (ev) {
      var box = ev.target;
      if (!(box instanceof HTMLInputElement) || (box.name !== 'repair_hands' && box.name !== 'repair_feet')) return;
      var form = box.closest('.finalize-form, .finalize-all-form');
      if (form) syncFinalizeDeliverOnly(form);
    });
  }

  function initFinalizeDeliverOnly() {
    qsa('.finalize-form, .finalize-all-form').forEach(syncFinalizeDeliverOnly);
    document.addEventListener('change', function (ev) {
      var box = ev.target;
      if (!(box instanceof HTMLInputElement) || box.name !== 'deliver_only') return;
      var form = box.closest('.finalize-form, .finalize-all-form');
      if (form) syncFinalizeDeliverOnly(form);
    });
  }

  // Resolves a dial word to its catalog number for display, e.g. denoise='tidy' -> 0.65.
  function resolveDialNumber(dials, key, value) {
    if (typeof value !== 'string') return null;
    var words = dials && dials[key];
    return words && Object.prototype.hasOwnProperty.call(words, value) ? words[value] : null;
  }

  // Mirrors finalizeOptionsFrom's payload so the preview can never drift from what gets sent.
  function renderFinalizePreview(form) {
    var preview = qs('.finalize-preview', form);
    if (!preview) return;
    var options = finalizeOptionsFrom(form, true);
    if (!options) {
      preview.textContent = '送信内容: —';
      return;
    }
    var dials = {};
    try { dials = JSON.parse(form.getAttribute('data-dials') || '{}'); } catch (e) { dials = {}; }
    var parts = [];
    var profile = profileRefFrom(form);
    if (profile) parts.push('profile ' + profile.name + (profile.version !== undefined ? ' v' + profile.version : ''));
    // backdrop is always sent and always meaningful, null included: null is the transparent choice.
    parts.push('backdrop=' + (options.backdrop === null ? 'transparent' : options.backdrop));
    Object.keys(options).forEach(function (key) {
      if (key === 'backdrop') return;
      var value = options[key];
      if (value === false || value === null || value === undefined) return;
      if (value === true) {
        parts.push(key);
      } else if (Array.isArray(value)) {
        parts.push(key + '=' + value.join('+'));
      } else if (typeof value === 'string') {
        var num = resolveDialNumber(dials, key, value);
        parts.push(key + ' ' + value + (num !== null ? ' (' + num + ')' : ''));
      } else {
        parts.push(key + '=' + value);
      }
    });
    preview.textContent = '送信内容: ' + parts.join(' · ');
  }

  function initFinalizePreview() {
    qsa('.finalize-form, .finalize-all-form').forEach(renderFinalizePreview);
    ['change', 'input', 'click'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        var form = ev.target.closest('.finalize-form, .finalize-all-form');
        if (!form) return;
        renderFinalizePreview(form);
      });
    });
  }

  function postFinalizeRequest(generationShortId, options, profile) {
    var payload = { generation_id: generationShortId, options: options };
    if (profile) payload.profile = profile;
    return api('/api/v1/requests', 'POST', {
      kind: 'finalize',
      payload: payload,
      idempotency_key: 'gui:finalize:' + generationShortId + ':' + crypto.randomUUID(),
      created_by: 'gui',
    });
  }

  // Same <li> markup FinalizeSection (src/ui/components/FinalizeSection.tsx) renders server-side.
  function requestStatusRow(request, showCreatedAt) {
    var li = document.createElement('li');
    li.className = 'request-status-' + request.status;
    li.setAttribute('data-request-id', request.id);
    li.setAttribute('data-request-status', request.status);
    li.appendChild(document.createTextNode(request.status + ' '));
    var progress = document.createElement('span');
    progress.className = 'request-progress';
    li.appendChild(progress);
    if (showCreatedAt && request.created_at) li.appendChild(document.createTextNode(' · ' + request.created_at));
    return li;
  }

  // queued 行はフォーム下に足され長いページでは視界外に出やすいため、ボタン自身で結果を返す
  function submitButtonFeedback(form) {
    var button = qs('button[type="submit"]', form);
    if (!button) return { sent: function () {}, failed: function () {} };
    var label = button.getAttribute('data-label') || button.textContent;
    button.setAttribute('data-label', label);
    clearTimeout(button._sentTimer);
    button.classList.remove('is-sent');
    button.disabled = true;
    button.textContent = 'Queueing…';
    function restore() {
      button.classList.remove('is-sent');
      button.disabled = false;
      button.textContent = label;
    }
    return {
      sent: function (text) {
        button.classList.add('is-sent');
        button.textContent = text;
        button._sentTimer = setTimeout(restore, 1500);
      },
      failed: restore,
    };
  }

  // queued 行をその場に足すだけで reload しない。以後の running/done は registerRequestElement
  // 経由の initRequestLive が反映する。
  function initFinalize() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.finalize-form');
      if (!form) return;
      ev.preventDefault();
      const shortId = form.getAttribute('data-generation-short-id');
      const options = finalizeOptionsFrom(form);
      if (!options) return;
      const profile = profileRefFrom(form);
      const feedback = submitButtonFeedback(form);
      try {
        const request = await postFinalizeRequest(shortId, options, profile);
        feedback.sent('Queued ✓');
        track('finalize.submit', Object.assign({ scope: 'one', generation_id: shortId, profile: profile }, options));
        const container = form.parentElement;
        if (container) {
          let list = qs('.request-status-list', container);
          if (!list) {
            list = document.createElement('ul');
            list.className = 'request-status-list';
            container.insertBefore(list, form.nextSibling);
          }
          const row = requestStatusRow(request, true);
          list.insertBefore(row, list.firstChild);
          registerRequestElement(row);
        }
      } catch (e) {
        feedback.failed();
        trackError('finalize.submit', e, { scope: 'one', generation_id: shortId });
        alert('finalize failed: ' + e.message);
      }
    });
  }

  function initFinalizeAll() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.finalize-all-form');
      if (!form) return;
      ev.preventDefault();
      const idsAttr = form.getAttribute('data-generation-short-ids') || '';
      const ids = idsAttr.split(',').filter(function (id) { return id.length > 0; });
      const options = finalizeOptionsFrom(form);
      if (!options) return;
      const profile = profileRefFrom(form);
      const feedback = submitButtonFeedback(form);
      try {
        const created = [];
        for (const shortId of ids) {
          created.push(await postFinalizeRequest(shortId, options, profile));
        }
        feedback.sent('Queued ' + created.length + ' ✓');
        track('finalize.submit', Object.assign({ scope: 'all', count: ids.length, profile: profile }, options));
        const container = form.parentElement;
        if (container) {
          const summary = qs('.finalize-summary', container);
          if (summary) {
            const match = /(\d+) queued/.exec(summary.textContent || '');
            const currentQueued = match ? parseInt(match[1], 10) : 0;
            summary.textContent = (summary.textContent || '').replace(/\d+ queued/, (currentQueued + created.length) + ' queued');
          }
          let list = qs('.request-status-list', container);
          if (!list) {
            list = document.createElement('ul');
            list.className = 'request-status-list';
            if (summary) container.insertBefore(list, summary.nextSibling);
            else container.insertBefore(list, form.nextSibling);
          }
          created.forEach(function (request) {
            const row = requestStatusRow(request, false);
            list.insertBefore(row, list.firstChild);
            registerRequestElement(row);
          });
        }
      } catch (e) {
        feedback.failed();
        trackError('finalize.submit', e, { scope: 'all', count: ids.length });
        alert('finalize failed: ' + e.message);
      }
    });
  }

  function initPromoteToProfile() {
    document.addEventListener('submit', async function (ev) {
      var form = ev.target.closest('.promote-profile-form');
      if (!form) return;
      ev.preventDefault();
      var generationId = form.getAttribute('data-generation-id');
      var nameInput = qs('input[name="name"]', form);
      var name = nameInput.value.trim();
      if (!name) return;
      var status = qs('.promote-profile-status', form);
      try {
        var result = await api('/api/v1/presets/promote-profile', 'POST', {
          generation_id: generationId,
          name: name,
          idempotency_key: 'gui:promote-profile:' + generationId + ':' + crypto.randomUUID(),
        });
        if (status) status.textContent = 'registered: ' + result.name + ' v' + result.version;
        track('promote_profile.submit', { generation_id: generationId, name: result.name, version: result.version });
      } catch (e) {
        trackError('promote_profile.submit', e, { generation_id: generationId });
        alert('promote failed: ' + e.message);
      }
    });
  }

  // /check ボタン押下で代表ポーズ全件の plain render を積み、request id をその場の右セルに挿す
  // だけ (reload しない)。以後は initRequestLive 経由で反映（requestLiveApplyStatus は下方定義だが関数宣言は巻き上がる）。
  function initStyleCheck() {
    document.addEventListener('click', async function (ev) {
      var button = ev.target.closest('[data-style-check-render]');
      if (!button) return;
      ev.preventDefault();
      var recipe = button.getAttribute('data-recipe');
      var label = button.textContent;
      button.disabled = true;
      button.textContent = 'Queueing…';
      try {
        var result = await api('/api/v1/style-check/' + encodeURIComponent(recipe), 'POST');
        (result.results || []).forEach(function (item) {
          if (item.skipped || (!item.created && item.status === 'done')) return;
          var slot = document.querySelector('[data-style-check-slot="' + item.pose + '"]');
          if (!slot) return;
          while (slot.firstChild) slot.removeChild(slot.firstChild);
          var ul = document.createElement('ul');
          ul.className = 'request-status-list';
          var li = requestStatusRow({ id: item.request_id, status: item.status }, false);
          ul.appendChild(li);
          slot.appendChild(ul);
          registerRequestElement(li);
        });
        track('style_check.render', { recipe: recipe });
      } catch (e) {
        trackError('style_check.render', e, { recipe: recipe });
        alert('style check render failed: ' + e.message);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  // /api/v1/requests/ws への接続を1本だけ共有する (docs/worker-protocol.md)。requestLive と
  // gallery live insertion はここに message type 別のハンドラを登録するだけ。再接続は 1s→2s→4s…上限30s。
  var viewerSocket = { ws: null, connecting: false, backoff: 1000, handlers: {} };

  function viewerSocketOn(type, handler) {
    if (!viewerSocket.handlers[type]) viewerSocket.handlers[type] = [];
    viewerSocket.handlers[type].push(handler);
  }

  function viewerSocketConnect() {
    if (viewerSocket.ws || viewerSocket.connecting) return;
    viewerSocket.connecting = true;
    var ws;
    try {
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      ws = new WebSocket(proto + location.host + '/api/v1/requests/ws');
    } catch (e) {
      viewerSocket.connecting = false;
      return; // WebSocket 未対応環境等 — 静的な表示のまま諦める
    }
    viewerSocket.ws = ws;
    ws.addEventListener('open', function () {
      viewerSocket.connecting = false;
      viewerSocket.backoff = 1000;
    });
    ws.addEventListener('message', function (ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (!data || !data.type) return;
      var handlers = viewerSocket.handlers[data.type];
      if (handlers) handlers.forEach(function (h) { h(data); });
    });
    ws.addEventListener('close', function () {
      viewerSocket.ws = null;
      viewerSocket.connecting = false;
      setTimeout(viewerSocketConnect, viewerSocket.backoff);
      viewerSocket.backoff = Math.min(viewerSocket.backoff * 2, 30000);
    });
    ws.addEventListener('error', function () {
      try {
        ws.close();
      } catch (e) {}
    });
  }

  // [data-request-id] は .request-status-list の <li> と GenerationCard の finalize 進捗ピルの
  // 2 種（後者は setFinalizeBadgeText が担当）。動的に追加された要素も registerRequestElement が
  // 都度登録し、未接続ならソケットを開く。
  var requestLive = { byId: {} };

  function isFinalizeBadge(el) {
    return el.classList.contains('card-finalize-badge');
  }

  // kind 表示ラベル。src/ui/components/GenerationCard.tsx の finalizeKindLabel と同じ規則。
  function finalizeKindLabel(kind) {
    return kind === 'repair' ? 'repair' : kind === 'masked_redraw' ? 'masked redraw' : 'finalize';
  }

  // GenerationCard.tsx の FinalizeBadge が組む構造と同じテキストを再現する。extra.step/total は
  // running中のprogressメッセージから、extra.resultShortId はdone確定後のresult取得から渡す。
  function setFinalizeBadgeText(el, extra) {
    var kind = el.getAttribute('data-request-kind');
    var status = el.getAttribute('data-request-status');
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(finalizeKindLabel(kind) + ' · '));
    if (status === 'running') {
      var text = 'running';
      if (extra && typeof extra.step === 'number' && typeof extra.total === 'number') {
        text += ' ' + extra.step + '/' + extra.total;
      }
      el.appendChild(document.createTextNode(text));
    } else if (status === 'done') {
      el.appendChild(document.createTextNode('done → '));
      var code = document.createElement('span');
      code.className = 'card-finalize-result';
      code.textContent = (extra && extra.resultShortId) || '';
      el.appendChild(code);
    } else {
      el.appendChild(document.createTextNode(status || ''));
    }
  }

  function requestLiveApplyProgress(p) {
    var el = requestLive.byId[p.request_id];
    if (!el) return;
    if (isFinalizeBadge(el)) {
      if (el.getAttribute('data-request-status') === 'running') {
        setFinalizeBadgeText(el, { step: p.step, total: p.total });
      }
      return;
    }
    var span = qs('.request-progress', el);
    if (!span) return;
    var text = p.phase || '';
    if (typeof p.step === 'number' && typeof p.total === 'number') text += ' ' + p.step + '/' + p.total;
    span.textContent = text;
  }

  async function requestLiveApplyStatus(s) {
    var el = requestLive.byId[s.request_id];
    if (!el) return;
    el.className = el.className.replace(/request-status-\S+/, '').trim();
    el.classList.add('request-status-' + s.status);
    el.setAttribute('data-request-status', s.status);

    if (isFinalizeBadge(el)) {
      setFinalizeBadgeText(el);
      if (s.status !== 'done') return;
      try {
        var badgeDetail = await api('/api/v1/requests/' + s.request_id, 'GET');
        if (badgeDetail.result && badgeDetail.result.generation_ids && badgeDetail.result.generation_ids[0]) {
          var badgeGen = await api('/api/v1/generations/' + badgeDetail.result.generation_ids[0], 'GET');
          setFinalizeBadgeText(el, { resultShortId: badgeGen.short_id });
        }
      } catch (e) {
        // 詳細取得に失敗してもstatusクラス自体は反映済みなので諦める
      }
      return;
    }

    if (s.status !== 'done' && s.status !== 'failed') return;
    var existingResult = qs('.request-result', el);
    if (existingResult) existingResult.remove();
    try {
      var detail = await api('/api/v1/requests/' + s.request_id, 'GET');
      var span = document.createElement('span');
      span.className = 'request-result';
      if (s.status === 'done' && detail.result && detail.result.generation_ids && detail.result.generation_ids[0]) {
        var gen = await api('/api/v1/generations/' + detail.result.generation_ids[0], 'GET');
        span.appendChild(document.createTextNode(' — '));
        var a = document.createElement('a');
        a.href = '/g/' + gen.short_id;
        a.textContent = gen.short_id;
        span.appendChild(a);
        el.appendChild(span);
      } else if (s.status === 'failed' && detail.error) {
        span.textContent = ' — ' + detail.error;
        el.appendChild(span);
      }
    } catch (e) {
    }
  }

  viewerSocketOn('snapshot', function (data) {
    (data.progress || []).forEach(requestLiveApplyProgress);
  });
  viewerSocketOn('progress', requestLiveApplyProgress);
  viewerSocketOn('status', requestLiveApplyStatus);

  function registerRequestElement(el) {
    var id = el.getAttribute('data-request-id');
    if (!id) return;
    requestLive.byId[id] = el;
    viewerSocketConnect();
  }

  function initRequestLive() {
    qsa('[data-request-id]').forEach(registerRequestElement);
  }

  // 新着/bad非表示はグリッドへ即座に反映しない（操作中のカードが手元で動かないよう件数を
  // 帯/ピルに出し、押したときにまとめて反映する）。queue は到着順の { shortId, html }。
  var galleryPending = { queue: [] };

  function galleryGrid() {
    return document.querySelector('[data-gallery-grid]');
  }

  function galleryLiveGrid() {
    var grid = galleryGrid();
    return grid && grid.getAttribute('data-gallery-live') === 'true' ? grid : null;
  }

  // bad=1 でも ids= でもない /gallery の既定表示だけ。Bookmarks / Batch Detail には属性が無い。
  function galleryHideBadGrid() {
    var grid = galleryGrid();
    return grid && grid.getAttribute('data-hide-bad') === 'true' ? grid : null;
  }

  function markGalleryPendingBad(id, isBad) {
    var grid = galleryHideBadGrid();
    if (!grid) return;
    var group = grid.querySelector('.rating-group[data-generation-id="' + id + '"]');
    var card = group ? group.closest('.card') : null;
    if (!card) return;
    card.classList.toggle('card-pending-hide', isBad);
    updateGalleryPendingUi();
  }

  function galleryLiveAcceptsView(view, refinesShortId) {
    if (view === 'raw') return !refinesShortId;
    if (view === 'refined') return Boolean(refinesShortId);
    return true; // 'all'
  }

  function galleryInsertCardHtml(html, grid) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    var card = wrapper.querySelector('.card');
    if (!card) return;
    grid.insertBefore(card, grid.firstChild);
    qsa('[data-request-id]', card).forEach(registerRequestElement);
  }

  function galleryPendingQueued(shortId) {
    return galleryPending.queue.some(function (item) {
      return item.shortId === shortId;
    });
  }

  function galleryPendingLabel(newCount, badCount) {
    var parts = [];
    if (newCount > 0) parts.push('新着 ' + newCount + ' 件');
    if (badCount > 0) parts.push('bad ' + badCount + ' 件を隠す');
    return parts.join(' · ');
  }

  var GALLERY_PENDING_ARROW =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M8 13V3M3 8l5-5 5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  function galleryPendingControls(grid) {
    var strip = document.getElementById('gallery-pending-strip');
    if (!strip) {
      strip = document.createElement('button');
      strip.type = 'button';
      strip.id = 'gallery-pending-strip';
      strip.className = 'gallery-pending-strip hidden';
      grid.parentNode.insertBefore(strip, grid);
      strip.addEventListener('click', function () {
        applyGalleryPending('strip');
      });
    }
    var pill = document.getElementById('gallery-pending-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.id = 'gallery-pending-pill';
      pill.className = 'gallery-pending-pill hidden';
      document.body.appendChild(pill);
      pill.addEventListener('click', function () {
        applyGalleryPending('pill');
      });
    }
    return { strip: strip, pill: pill };
  }

  function updateGalleryPendingUi() {
    var grid = galleryGrid();
    if (!grid) return;
    var newCount = galleryPending.queue.length;
    var badCount = qsa('.card.card-pending-hide', grid).length;
    var controls = galleryPendingControls(grid);
    var label = galleryPendingLabel(newCount, badCount);
    controls.strip.textContent = label;
    controls.strip.classList.toggle('hidden', label === '');
    controls.pill.innerHTML = (newCount > 0 ? GALLERY_PENDING_ARROW : '') + '<span></span>';
    qs('span', controls.pill).textContent = label;
    updateGalleryPendingPill();
  }

  // 帯が sticky toolbar の下へスクロールアウトしている間だけピルを出す。
  function updateGalleryPendingPill() {
    var strip = document.getElementById('gallery-pending-strip');
    var pill = document.getElementById('gallery-pending-pill');
    if (!strip || !pill) return;
    var show = false;
    if (!strip.classList.contains('hidden')) {
      var toolbar = qs('.gallery-toolbar');
      var toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : 0;
      show = strip.getBoundingClientRect().bottom <= toolbarBottom;
      // toolbar の高さは折り返しで変わるので、CSS の既定位置ではなく実測した直下に置く
      if (show && toolbar) pill.style.top = toolbarBottom + 8 + 'px';
    }
    pill.classList.toggle('hidden', !show);
  }

  function applyGalleryPending(source) {
    var grid = galleryGrid();
    if (!grid) return;
    var newCount = galleryPending.queue.length;
    var badCards = qsa('.card.card-pending-hide', grid);
    // 先頭挿入を古い方から繰り返すと、最終的に新しい方が一番上に来る (newest first)。
    galleryPending.queue.forEach(function (item) {
      galleryInsertCardHtml(item.html, grid);
    });
    galleryPending.queue = [];
    badCards.forEach(function (card) {
      card.remove();
    });
    updateGalleryPendingUi();
    if (newCount > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    track('gallery.pending_apply', { new_count: newCount, hidden_count: badCards.length, source: source });
  }

  function handleGenerationMessage(msg) {
    var grid = galleryLiveGrid();
    if (!grid) return;
    var view = grid.getAttribute('data-gallery-view') || 'all';
    if (!galleryLiveAcceptsView(view, msg.refines_generation_short_id)) return;
    if (grid.querySelector('.thumb-link[data-short-id="' + msg.short_id + '"]')) return; // already on the grid
    if (galleryPendingQueued(msg.short_id)) return;

    fetch('/g/' + encodeURIComponent(msg.short_id) + '?partial=card')
      .then(function (res) {
        if (!res.ok) throw new Error('card fetch failed: ' + res.status);
        return res.text();
      })
      .then(function (html) {
        if (!galleryLiveGrid() || galleryPendingQueued(msg.short_id)) return;
        galleryPending.queue.push({ shortId: msg.short_id, html: html });
        updateGalleryPendingUi();
      })
      .catch(function (e) {
        trackError('gallery.new_arrivals', e, { short_id: msg.short_id });
      });
  }

  viewerSocketOn('generation', handleGenerationMessage);

  // GET /api/v1/requests/summary で初期表示し、以後は共有 viewer WebSocket (status/snapshot) を
  // 合図に再取得する (docs/ui.md「キュー状態」)。パネルの行は遷移リンクのみで操作は持たない。
  var navQueue = { fetching: false, pending: false, debounceTimer: null, lastSummary: null };

  function navQueueRelativeTime(iso) {
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return seconds + ' 秒前';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' 分前';
    var hours = Math.round(minutes / 60);
    return hours + ' 時間前';
  }

  function navQueuePillState(summary) {
    var c = summary.counts;
    var workersCount = (summary.workers || []).length;
    var segs = [];
    if (c.running > 0) segs.push({ cls: 'nav-queue-running', label: '実行中 ', value: c.running });
    if (c.queued > 0) segs.push({ cls: 'nav-queue-queued', label: '待ち ', value: c.queued });
    if (c.failed_24h > 0) segs.push({ cls: 'nav-queue-failed', label: '失敗 ', value: c.failed_24h });
    if (c.queued > 0 && workersCount === 0) segs.push({ cls: 'nav-queue-offline nav-queue-label', text: 'worker なし' });
    var dot = workersCount > 0 ? 'online' : (c.queued > 0 ? 'warn' : null);
    return { segs: segs, dot: dot };
  }

  function renderNavQueuePill(summary) {
    var details = document.getElementById('nav-queue');
    if (!details) return;
    var pill = qs('.nav-queue-pill', details);
    var dotEl = qs('.nav-queue-dot', pill);
    var textEl = qs('.nav-queue-text', pill);
    var state = navQueuePillState(summary);

    dotEl.className = 'nav-queue-dot' + (state.dot ? ' ' + state.dot : '');
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    pill.classList.toggle('nav-queue-empty', state.segs.length === 0);

    state.segs.forEach(function (seg, i) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'nav-queue-sep';
        sep.textContent = '·';
        textEl.appendChild(sep);
      }
      var span = document.createElement('span');
      span.className = seg.cls;
      if (seg.text !== undefined) {
        span.textContent = seg.text;
      } else {
        var label = document.createElement('span');
        label.className = 'nav-queue-label';
        label.textContent = seg.label;
        span.appendChild(label);
        span.appendChild(document.createTextNode(String(seg.value)));
      }
      textEl.appendChild(span);
    });
  }

  function navQueueRowCounts(counts) {
    var wrap = document.createElement('span');
    wrap.className = 'nav-queue-row-counts';
    [
      ['running', '実行中 '],
      ['queued', '待ち '],
      ['failed', '失敗 '],
    ].forEach(function (pair) {
      var n = counts[pair[0]];
      if (!n) return;
      var span = document.createElement('span');
      span.className = 'nav-queue-' + pair[0];
      span.textContent = pair[1] + n;
      wrap.appendChild(span);
    });
    return wrap;
  }

  function navQueueKindsText(group) {
    var parts = Object.keys(group.kinds).map(function (kind) {
      var count = group.kinds[kind];
      return count > 1 ? kind + ' \xd7' + count : kind;
    });
    var failedOnly = group.counts.running === 0 && group.counts.queued === 0 && group.counts.failed > 0;
    if (failedOnly) parts.push(navQueueRelativeTime(group.latest_at));
    return parts.join(' · ');
  }

  function navQueueRowLabel(group) {
    if (group.batch) return group.batch.short_id;
    if (group.experiment) return group.experiment.short_id;
    return group.key.replace(/^request:/, '').slice(0, 8);
  }

  function navQueueRow(group) {
    var el = document.createElement(group.href ? 'a' : 'div');
    el.className = 'nav-queue-row';
    if (group.href) el.setAttribute('href', group.href);

    var thumb = document.createElement('span');
    thumb.className = 'nav-queue-row-thumb';
    if (group.batch && group.batch.thumbnail_generation_short_id) {
      var img = document.createElement('img');
      img.src = '/g/' + encodeURIComponent(group.batch.thumbnail_generation_short_id) + '/preview';
      img.loading = 'lazy';
      img.alt = '';
      thumb.appendChild(img);
    }
    el.appendChild(thumb);

    var meta = document.createElement('span');
    meta.className = 'nav-queue-row-meta';
    var id = document.createElement('span');
    id.className = 'nav-queue-row-id';
    id.textContent = navQueueRowLabel(group);
    meta.appendChild(id);
    var kinds = document.createElement('span');
    kinds.className = 'nav-queue-row-kinds';
    kinds.textContent = navQueueKindsText(group);
    meta.appendChild(kinds);
    el.appendChild(meta);

    el.appendChild(navQueueRowCounts(group.counts));

    el.addEventListener('click', function () {
      track('queue.group.click', { kinds: group.kinds, has_batch: Boolean(group.batch) });
    });

    return el;
  }

  function renderNavQueuePanel(summary) {
    var details = document.getElementById('nav-queue');
    if (!details) return;
    var panel = qs('.nav-queue-panel', details);
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    if (summary.groups.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'nav-queue-empty-panel';
      empty.textContent = 'キューは空です';
      panel.appendChild(empty);
    }

    summary.groups.forEach(function (group) {
      panel.appendChild(navQueueRow(group));
    });

    var divider = document.createElement('div');
    divider.className = 'nav-queue-divider';
    panel.appendChild(divider);

    var foot = document.createElement('div');
    foot.className = 'nav-queue-foot';
    var workersCount = (summary.workers || []).length;
    foot.textContent = workersCount > 0 ? 'worker ' + workersCount + ' 台接続中' : 'worker 未接続';
    panel.appendChild(foot);
  }

  function renderNavQueue(summary) {
    navQueue.lastSummary = summary;
    renderNavQueuePill(summary);
    renderNavQueuePanel(summary);
  }

  function fetchNavQueueSummary() {
    if (navQueue.fetching) {
      navQueue.pending = true;
      return;
    }
    navQueue.fetching = true;
    api('/api/v1/requests/summary')
      .then(function (summary) {
        renderNavQueue(summary);
      })
      .catch(function (e) {
        trackError('queue.fetch', e, {});
      })
      .then(function () {
        navQueue.fetching = false;
        if (navQueue.pending) {
          navQueue.pending = false;
          fetchNavQueueSummary();
        }
      });
  }

  function debouncedFetchNavQueueSummary() {
    if (navQueue.debounceTimer) clearTimeout(navQueue.debounceTimer);
    navQueue.debounceTimer = setTimeout(fetchNavQueueSummary, 500);
  }

  function initNavQueue() {
    var details = document.getElementById('nav-queue');
    if (!details) return;

    fetchNavQueueSummary();
    viewerSocketConnect();
    viewerSocketOn('status', debouncedFetchNavQueueSummary);
    viewerSocketOn('snapshot', debouncedFetchNavQueueSummary);

    details.addEventListener('toggle', function () {
      if (!details.open) return;
      fetchNavQueueSummary();
      track('queue.open', { counts: navQueue.lastSummary ? navQueue.lastSummary.counts : null });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fetchNavQueueSummary();
    });
  }

  // Opening one closes the others with no extra logic: this listener fires before the <details>
  // summary's own toggle, so the popover about to open is still closed here and is skipped.
  function popoverDetailsEls() {
    return qsa('details.nav-more, details.nav-queue, details.filter-panel');
  }

  function initPopoverClose() {
    document.addEventListener('click', function (ev) {
      // The queue panel is rebuilt on every summary push; a click on a node removed mid-click is not "outside".
      if (!ev.target.isConnected) return;
      popoverDetailsEls().forEach(function (d) {
        if (d.open && !d.contains(ev.target)) d.open = false;
      });
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      popoverDetailsEls().forEach(function (d) {
        if (d.open) d.open = false;
      });
    });
  }

  function initGalleryPending() {
    if (!galleryGrid()) return;
    if (galleryLiveGrid()) viewerSocketConnect();
    window.addEventListener('scroll', updateGalleryPendingPill, { passive: true });
  }

  // 「比較に追加」ボタンが sessionStorage の compare set をトグルし、#compare-bar がこの set を
  // 描画する (docs/ui.md「Compare entry」)。要素は { id, short_id }: short_id を持つのはチップの
  // サムネイルをカードと同じ画像 URL にしてブラウザキャッシュを共有するため。
  var COMPARE_SET_KEY = 'chimera-compare-set';
  var COMPARE_MAX = 9;

  function readCompareSet() {
    try {
      var raw = sessionStorage.getItem(COMPARE_SET_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (e) {
        return e && typeof e.id === 'string';
      });
    } catch (e) {
      return [];
    }
  }
  function writeCompareSet(entries) {
    try {
      sessionStorage.setItem(COMPARE_SET_KEY, JSON.stringify(entries));
    } catch (e) {
      // sessionStorage unavailable (private mode 等) -- compare setはタブ内限定で諦める
    }
  }
  function compareRef(entry) {
    return entry.short_id || entry.id;
  }
  function compareIndexOf(entries, id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return i;
    }
    return -1;
  }
  function renderCompareChips(container, entries) {
    var key = entries.map(compareRef).join(',');
    if (container.getAttribute('data-ids') === key) return;
    container.setAttribute('data-ids', key);
    container.textContent = '';
    entries.forEach(function (entry, i) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = i < COMPARE_MAX ? 'compare-chip' : 'compare-chip compare-chip-overflow';
      chip.setAttribute('data-generation-id', entry.id);
      chip.title = compareRef(entry) + ' を比較から外す';
      chip.setAttribute('aria-label', chip.title);
      var img = document.createElement('img');
      img.src = '/g/' + encodeURIComponent(compareRef(entry)) + '/preview';
      img.alt = '';
      var x = document.createElement('span');
      x.className = 'compare-chip-x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      chip.appendChild(img);
      chip.appendChild(x);
      container.appendChild(chip);
    });
  }
  function updateCompareBar() {
    var entries = readCompareSet();
    var bar = document.getElementById('compare-bar');
    if (bar) {
      bar.classList.toggle('hidden', entries.length === 0);
      var link = qs('#compare-link', bar);
      link.textContent = 'Compare (' + Math.min(entries.length, COMPARE_MAX) + ')';
      link.setAttribute('href', '/compare?ids=' + entries.slice(0, COMPARE_MAX).map(compareRef).join(','));
      renderCompareChips(qs('#compare-chips', bar), entries);
    }
    qsa('.compare-add-btn').forEach(function (btn) {
      var active = compareIndexOf(entries, btn.getAttribute('data-generation-id')) !== -1;
      btn.classList.toggle('active', active);
      btn.textContent = active ? '比較から外す' : '比較に追加';
    });
  }
  function toggleCompare(id, shortId) {
    if (!id) return;
    var entries = readCompareSet();
    var idx = compareIndexOf(entries, id);
    if (idx === -1) entries.push({ id: id, short_id: shortId || null });
    else entries.splice(idx, 1);
    writeCompareSet(entries);
    updateCompareBar();
    track('compare.add', { generation_id: id, count: entries.length });
  }
  function removeFromCompare(id) {
    var entries = readCompareSet();
    var idx = compareIndexOf(entries, id);
    if (idx === -1) return;
    entries.splice(idx, 1);
    writeCompareSet(entries);
    updateCompareBar();
    track('compare.remove', { generation_id: id, count: entries.length });
  }
  function clearCompare() {
    var count = readCompareSet().length;
    writeCompareSet([]);
    updateCompareBar();
    track('compare.clear', { count: count });
  }
  function initCompareBar() {
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest) return;
      var addBtn = ev.target.closest('.compare-add-btn');
      if (addBtn) {
        toggleCompare(addBtn.getAttribute('data-generation-id'), addBtn.getAttribute('data-short-id'));
        return;
      }
      var chip = ev.target.closest('.compare-chip');
      if (chip) {
        removeFromCompare(chip.getAttribute('data-generation-id'));
        return;
      }
      if (ev.target.closest('#compare-clear')) {
        clearCompare();
        return;
      }
      if (ev.target.closest('#compare-link')) track('compare.open', { count: readCompareSet().length });
    });
    // 別ページで set を変えてから Back で戻ったとき (bfcache 復元) にバーを描き直す
    window.addEventListener('pageshow', function (ev) {
      if (ev.persisted) updateCompareBar();
    });
    updateCompareBar();
  }

  function initAbJudge() {
    const root = qs('.ab-root');
    if (!root) return;

    const pairsEl = document.getElementById('ab-pairs');
    let pairs = [];
    try { pairs = JSON.parse((pairsEl && pairsEl.textContent) || '[]'); } catch (e) { pairs = []; }

    const experimentId = root.getAttribute('data-experiment-id');
    const baselineRunId = root.getAttribute('data-baseline-run-id');
    const armRunId = root.getAttribute('data-arm-run-id');
    let judged = parseInt(root.getAttribute('data-judged') || '0', 10);
    const total = parseInt(root.getAttribute('data-total') || '0', 10);
    let index = 0;
    // キー連打で同じペアを二重 POST すると 2 件目の 409 で index が余分に進みペアを飛ばすので、送信中は受け付けない。
    let inFlight = false;

    const progressEl = qs('.ab-progress');
    const doneEl = qs('.ab-done', root);
    const areaEl = qs('.ab-pair-area', root);
    const seedEl = qs('.ab-seed-value', root);
    const leftLink = qs('.ab-side[data-side="left"]', root);
    const rightLink = qs('.ab-side[data-side="right"]', root);
    const leftImg = leftLink ? leftLink.querySelector('img') : null;
    const rightImg = rightLink ? rightLink.querySelector('img') : null;
    const voteButtons = qsa('.ab-vote', root);
    const revealEl = qs('.ab-reveal', root);
    const revealLineEl = qs('.ab-reveal-line', root);
    const nextBtn = qs('.ab-next', root);

    function updateProgress() {
      if (progressEl) progressEl.textContent = judged + ' / ' + total;
    }

    function setButtonsDisabled(disabled) {
      voteButtons.forEach(function (b) { b.disabled = disabled; });
    }

    function renderCurrent() {
      if (revealEl) revealEl.hidden = true;
      if (index >= pairs.length) {
        if (areaEl) areaEl.hidden = true;
        if (doneEl) doneEl.hidden = false;
        return;
      }
      const pair = pairs[index];
      if (seedEl) seedEl.textContent = String(pair.seed);
      if (leftImg) leftImg.src = pair.left.image_url;
      if (leftLink) leftLink.href = pair.left.image_url;
      if (rightImg) rightImg.src = pair.right.image_url;
      if (rightLink) rightLink.href = pair.right.image_url;
      setButtonsDisabled(false);
    }

    // reveal.render_diff の各行を "column: baseline → arm"（delta 付きは "column: <delta>"）に
    // まとめる。POST の 409（既に判定済み）は response body を持たないため、成功時のみ通る整形。
    function formatReveal(reveal) {
      var line = 'A = #' + reveal.left.run_index + ' (' + reveal.left.role + ') · B = #' + reveal.right.run_index + ' (' + reveal.right.role + ')';
      if (reveal.render_diff && reveal.render_diff.length > 0) {
        reveal.render_diff.forEach(function (d) {
          if (d.delta) {
            line += ' · ' + d.column + ': ' + d.delta;
          } else {
            line += ' · ' + d.column + ': ' + (d.baseline == null ? '—' : d.baseline) + ' → ' + (d.arm == null ? '—' : d.arm);
          }
        });
      } else {
        line += ' · no fact difference';
      }
      return line;
    }

    function showReveal(text) {
      if (revealLineEl) revealLineEl.textContent = text;
      if (revealEl) revealEl.hidden = false;
    }

    function advance() {
      index += 1;
      renderCurrent();
    }

    async function vote(verdict) {
      const pair = pairs[index];
      if (!pair || inFlight) return;
      inFlight = true;
      setButtonsDisabled(true);
      try {
        const res = await api('/api/v1/experiments/' + experimentId + '/judgments', 'POST', {
          baseline_run_id: baselineRunId,
          arm_run_id: armRunId,
          seed: pair.seed,
          left_generation_id: pair.left.id,
          right_generation_id: pair.right.id,
          verdict: verdict,
        });
        judged += 1;
        updateProgress();
        showReveal(formatReveal(res.reveal));
        track('judge.pick', { experiment_id: experimentId, verdict: verdict, seed: pair.seed, index: index, judged: judged });
      } catch (e) {
        if (e.status === 409) {
          judged += 1;
          updateProgress();
          showReveal('already judged');
          track('judge.pick', { experiment_id: experimentId, verdict: verdict, seed: pair.seed, index: index, judged: judged, duplicate: true });
          return;
        }
        trackError('judge.pick', e, { experiment_id: experimentId, verdict: verdict, seed: pair.seed, index: index });
        alert('judgment failed: ' + e.message);
        setButtonsDisabled(false);
      } finally {
        inFlight = false;
      }
    }

    voteButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        vote(btn.getAttribute('data-verdict'));
      });
    });

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        advance();
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (!areaEl || areaEl.hidden) return;
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
      if (revealEl && !revealEl.hidden) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          advance();
        }
        return;
      }
      if (ev.key === '1' || ev.key === 'ArrowLeft') vote('left');
      else if (ev.key === '2' || ev.key === 'ArrowRight') vote('right');
      else if (ev.key === '0' || ev.key === 't' || ev.key === 'T') vote('tie');
    });

    updateProgress();
    renderCurrent();
  }

  // Fires on submit before the normal GET navigation happens; preventDefault is intentionally not called.
  function initGalleryFilter() {
    document.addEventListener('submit', function (ev) {
      const form = ev.target.closest('.filter-form');
      if (!form) return;
      const fields = {};
      new FormData(form).forEach(function (value, key) {
        if (value !== '') fields[key] = value;
      });
      track('gallery.filter', fields);
    });
  }

  // 同じ理由で preventDefault は呼ばない (src/ui/components/ViewSwitch.tsx, .bad-toggle)。
  function initGalleryView() {
    document.addEventListener('click', function (ev) {
      const viewLink = ev.target.closest ? ev.target.closest('.view-switch a') : null;
      const badLink = ev.target.closest ? ev.target.closest('.bad-toggle') : null;
      if (viewLink) {
        const badToggle = qs('.bad-toggle');
        const bad = badToggle ? badToggle.getAttribute('aria-pressed') === 'true' : false;
        track('gallery.view', { view: viewLink.getAttribute('data-view'), bad: bad });
      } else if (badLink) {
        const currentView = qs('.view-switch a[aria-current="true"]');
        const view = currentView ? currentView.getAttribute('data-view') : null;
        const bad = badLink.getAttribute('aria-pressed') !== 'true';
        track('gallery.view', { view: view, bad: bad });
      }
    });
  }

  // Fetches .load-more's href with partial=1, appended as an HTML fragment (cards + the next
  // .load-more link, or nothing).
  var galleryLoadMoreInFlight = false;
  var galleryScrollObserver = null;

  function galleryPartialUrl(href) {
    const url = new URL(href, location.href);
    url.searchParams.set('partial', '1');
    return url.toString();
  }

  async function loadMoreGalleryCards(link) {
    const grid = document.querySelector('[data-gallery-grid]');
    if (!grid || !link) return false;
    if (galleryLoadMoreInFlight) return false;
    galleryLoadMoreInFlight = true;
    if (galleryScrollObserver) galleryScrollObserver.unobserve(link);
    try {
      const res = await fetch(galleryPartialUrl(link.getAttribute('href')));
      if (!res.ok) return false;
      const html = await res.text();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      const nextLoadMore = wrapper.querySelector('.load-more');
      qsa('.card, .load-more', wrapper).forEach(function (node) {
        if (node !== nextLoadMore) grid.insertBefore(node, link);
      });
      link.remove();
      if (nextLoadMore) {
        grid.appendChild(nextLoadMore);
        if (galleryScrollObserver) galleryScrollObserver.observe(nextLoadMore);
      }
      return true;
    } catch (e) {
      trackError('gallery.load_more', e, {});
      return false;
    } finally {
      galleryLoadMoreInFlight = false;
    }
  }

  function initGalleryInfiniteScroll() {
    const grid = document.querySelector('[data-gallery-grid]');
    if (!grid || !window.IntersectionObserver) return;
    galleryScrollObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) loadMoreGalleryCards(entry.target);
      });
    });
    const initial = qs('.load-more', grid);
    if (initial) galleryScrollObserver.observe(initial);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initRating();
    initBookmark();
    initThumbPreview();
    initTagAdd();
    initTagRemove();
    initTagSuggestions();
    initNoteForm();
    initPublicationAdd();
    initPublicationUrlSave();
    initPublicationRemove();
    initPoseReference();
    initFinalize();
    initFinalizeAll();
    initFinalizeBackdropColor();
    initFinalizeRepairRegions();
    initFinalizeRepairPad();
    initFinalizeDeliverOnly();
    initFinalizePreview();
    initDialGroups();
    initProfileButtons();
    initPromoteToProfile();
    initStyleCheck();
    initGalleryFilter();
    initGalleryView();
    initGalleryInfiniteScroll();
    initGalleryPending();
    initRequestLive();
    initNavQueue();
    initPopoverClose();
    initCompareBar();
    initCopyIdButtons();
    initCompareCols();
    initExperimentStatus();
    initAbJudge();
  });
})();
`;

// content hash (FNV-1a): アセット URL の ?v= に使い、デプロイごとにキャッシュを破棄する
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
export const assetVersion = fnv1a(styleCss + appJs);
