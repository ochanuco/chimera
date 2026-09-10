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
  /* Generation 画像を置く面すべてに敷く市松。透過部分と余白を見分けるためのもので、img 自体には手を加えない */
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

/* GenerationCard のサムネイルオーバーレイ (docs/ui.md「Gallery」カード)。from-badge は Lightbox の
   from-row でも同じ見た目を静的な行として使う (position は .thumb-link の中でだけ絶対配置)。 */
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

/* from-badge と finalizeピルを縦に積むコンテナ (docs/ui.md「Gallery」)。from-badge が無ければ
   finalizeピルだけがこの位置に来る。 */
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

/* finalize/repair/masked_redraw の進捗ピル (docs/ui.md「Gallery」)。request-status-* は
   .request-status-list と共通の色クラス (このファイル下方)。 */
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

.card-published-pill {
  position: absolute;
  bottom: 0.4rem;
  left: 0.4rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(18, 18, 20, 0.86);
  border: 1px solid var(--border);
  color: #4fd8a4;
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
/* 親の高さが auto だと max-height: 100% は効かないため、img に直接ビューポート基準の上限を課す。
   26px = 外側マージン 8px×2 + パディング 4px×2 + ボーダー 1px×2（枠ごとビューポートに収める） */
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
/* ID の文字そのものがコピーボタン (GenerationCard)。コピーしたら文字を置き換えず色と ✓ で知らせる */
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

/* Lightbox の大きいrating group (docs/ui.md「Lightbox」)。 */
.rating-group-lg .rate-btn { font-size: 0.8rem; padding: 0.3rem 0.75rem; }

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

/* Relation-type badges for 親/子/兄弟 rows (Batch/Generation Detail). */
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

/* 公開セクション (Generation Detail「公開」, docs/ui.md参照)。 */
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

/* 比較エントリ (docs/ui.md「Compare entry」)。sessionStorage の compare set をトグルする。 */
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

/* Layout が全ページに置く。固定配置なので、表示中は main 末尾がバーに隠れないよう余白を足す */
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

/* Gallery ツールバー (view switch / bad toggle / 絞り込みパネル)。nav の下に sticky で張り付く。 */
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

/* Gallery の反映待ち (docs/ui.md「Gallery pending changes」)。帯はグリッドの直前、ピルは帯が
   スクロールアウトしている間だけ sticky ツールバーの直下中央に浮かぶ。 */
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

  /* GenerationCard: bookmark はサムネイル右上のヒット領域に、rating は行いっぱいに広げる (docs/ui.md「Gallery」)。 */
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

/* Generation Detail の Workflow セクション: モデル/LoRA/ControlNetのkv-tableに続けてPassごとのブロックを並べる。 */
.workflow-pass { border-left: 2px solid var(--border); padding-left: 0.6rem; margin: 0.6rem 0; }
.workflow-pass-head { font-weight: 600; }
.workflow-line { color: var(--text-dim); font-size: 0.85rem; }

.gen-detail-hero { text-align: center; margin-bottom: 1rem; }
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
  /* 縦 flex にして画像へ残り全高を割り当てる。hero を height: 100% にすると
     直後の .image-meta がスクロール下に押し出されて見えなくなる */
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
.finalize-form button, .finalize-all-form button {
  align-self: flex-start;
  background: var(--accent);
  color: #10131c;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}
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
  /* 吹き出しの位置基準。マーカー基準にすると、右ペインが overflow-y: auto で
     横もクリップするため右寄りのマーカーで切れる */
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

.request-status-list { list-style: none; margin: 0.6rem 0 0; padding: 0; font-size: 0.85rem; }
.request-status-queued { color: var(--accent); }
.request-status-running { color: var(--neutral); }
.request-status-done { color: var(--good); }
.request-status-failed { color: var(--bad); }
.request-status-cancelled { color: var(--text-dim); }
.request-progress { color: var(--text-dim); margin-left: 0.4rem; font-variant-numeric: tabular-nums; }

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
/* grid の auto-fill で列幅を全行共通にする（flex-wrap だと折り返し後の行だけカードが伸びる）。
   列数指定時は initCompareCols が grid-template-columns をインラインで上書きする */
.compare-columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 320px)); gap: 1rem; }
.compare-col { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem; }
.compare-col img { width: 100%; border-radius: 6px; margin-bottom: 0.5rem; background: var(--checker); }
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

/* Lightbox (Gallery / Bookmarks / Batch Detail のサムネイルクリック, docs/ui.md「Lightbox」)。
   overlay/画像/prev-next はJSが組み立て、.lightbox-panel の中身だけ GET /g/:short_id?partial=lightbox
   のfragmentをそのまま挿入する。 */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(8, 8, 10, 0.78);
  display: flex;
  flex-direction: column;
}
.lightbox-overlay[hidden] { display: none; }
body.lightbox-open { overflow: hidden; }

.lightbox-topbar { display: none; }
.lightbox-stage { flex: 1; min-height: 0; }
.lightbox-image-area { position: relative; }
.lightbox-image-area img.lightbox-image { background: var(--checker); display: block; }
.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  background: rgba(27, 27, 31, 0.92);
  border: 1px solid var(--border);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.lightbox-nav[hidden] { display: none; }
.lightbox-prev { left: 0.75rem; }
.lightbox-next { right: 0.75rem; }

.lightbox-panel {
  font-size: 0.85rem;
}
.lightbox-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.7rem; }
.lightbox-short-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.15rem; font-weight: 600; }
.lightbox-header-actions { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
.lightbox-close {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lightbox-close:hover { color: var(--text); }
.lightbox-meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: var(--text-dim); margin: 0 0 0.6rem; }
.lightbox-from-row { margin: 0 0 0.6rem; }

@media (min-width: 1100px) {
  .lightbox-stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 420px;
    /* 行を auto にすると画像の原寸で行が伸び、max-height: 100% が効かず画像が見切れる */
    grid-template-rows: minmax(0, 1fr);
    gap: 1.25rem;
    padding: 1.5rem 2rem;
    height: 100%;
  }
  .lightbox-image-area { height: 100%; display: flex; align-items: center; justify-content: center; }
  .lightbox-image-area img.lightbox-image { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; border-radius: 10px; }
  .lightbox-panel {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    overflow-y: auto;
  }
}

@media (max-width: 1099.98px) {
  .lightbox-overlay { background: var(--bg); }
  .lightbox-topbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.25rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .lightbox-topbar .lightbox-close { width: 2.75rem; height: 2.75rem; }
  .lightbox-topbar-short-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; }
  .lightbox-topbar-detail-link { margin-left: auto; font-size: 0.85rem; }
  .lightbox-stage { display: flex; flex-direction: column; overflow-y: auto; }
  .lightbox-image-area img.lightbox-image {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: calc(100dvh - 3.25rem);
    margin: 0 auto;
    object-fit: contain;
  }
  .lightbox-nav { display: none; }
  .lightbox-panel { padding: 0.9rem 1rem 2rem; }
  .lightbox-panel .rate-btn { flex: 1; min-height: 2.75rem; }
  .lightbox-panel .rating-group { flex: 1; display: flex; }
  .lightbox-panel button,
  .lightbox-panel input,
  .lightbox-panel select,
  .lightbox-panel textarea { min-height: 2.75rem; }
  .lightbox-panel .tag-chip,
  .lightbox-panel .publication-remove-btn,
  .lightbox-panel .tag-remove-btn,
  .lightbox-panel .copy-id-btn { min-height: 0; }
}
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

  // --- Telemetry (docs/ui.md "Telemetry"): /assets/telemetry.js が PostHog を初期化した
  // ときだけ window.posthog がある。無効時は no-op。
  // 多くの呼び出し元が capture 直後に reload / 遷移するので、バッチに乗せず即時 beacon で送る。
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

  // --- Clipboard helpers (used by copy-id buttons) ---
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
  // 連続でコピーしたときに前回のタイマーが ✓ を早く消さないよう、ボタンごとに保持する
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
  // group と Lightbox の両方に同じGenerationのrating-groupが同時に存在しうるので、
  // data-generation-id が一致する全要素に反映する (docs/ui.md「Lightbox」)。
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
        track('bookmark.toggle', { kind: kind, id: id, bookmarked: !bookmarked });
      } catch (e) {
        trackError('bookmark.toggle', e, { kind: kind, id: id });
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
        track('experiment.status', { experiment_id: id, from: previous, to: next });
        location.reload();
      } catch (e) {
        trackError('experiment.status', e, { experiment_id: id, from: previous, to: next });
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
        track('tag.add', { kind: kind, id: id, tag: tag.name });
      } catch (e) {
        trackError('tag.add', e, { kind: kind, id: id });
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
        track('tag.remove', { kind: kind, id: id, tag_id: tagId });
      } catch (e) {
        trackError('tag.remove', e, { kind: kind, id: id, tag_id: tagId });
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
        track('note.save', { kind: kind, id: id, length: textarea.value.length });
      } catch (e) {
        trackError('note.save', e, { kind: kind, id: id });
        if (status) status.textContent = 'failed: ' + e.message;
      }
    });
  }

  // --- Publication (Generation Detail「公開」, docs/ui.md参照) ---
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

  // --- Finalize (worker-protocol.md: GUI が積んでよいのは finalize だけ) ---
  // Returns null when the form cannot be turned into options. In quiet mode (used by the
  // preview) that happens silently; otherwise it alerts on a malformed backdrop colour.
  function finalizeOptionsFrom(form, quiet) {
    var denoiseRaw = qs('input[name="denoise"]', form).value;
    var recolor = qs('input[name="recolor"]', form);
    var backdropMode = qs('select[name="backdrop"]', form).value;
    var backdrop = backdropMode === 'transparent' ? null : backdropMode;
    if (backdropMode === 'color') {
      backdrop = qs('input[name="backdrop_color"]', form).value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(backdrop)) {
        if (!quiet) alert('backdrop color must be #RRGGBB');
        return null;
      }
    }
    var strokeLight = qs('select[name="stroke_light"]', form).value;
    var options = {
      repin: qs('input[name="repin"]', form).checked,
      recolor: recolor ? recolor.checked : false,
      keep_legwear: qs('input[name="keep_legwear"]', form).checked ? true : null,
      denoise: denoiseRaw === '' ? null : Number(denoiseRaw),
      backdrop: backdrop,
      stroke_light: strokeLight === 'none' ? null : strokeLight,
    };

    var repair = [];
    if (qs('input[name="repair_hands"]', form).checked) repair.push('hands');
    if (qs('input[name="repair_feet"]', form).checked) repair.push('feet');
    if (repair.length > 0) options.repair = repair;

    var repairPadRaw = qs('input[name="repair_pad"]', form).value;
    if (repair.length > 0 && repairPadRaw !== '') options.repair_pad = Number(repairPadRaw);

    var repairLoraRaw = qs('input[name="repair_lora"]', form).value;
    if (repair.length > 0 && repairLoraRaw !== '') options.repair_lora = Number(repairLoraRaw);

    return options;
  }

  // The color input stays disabled while hidden so the browser's pattern check
  // cannot block submit on a control it has no way to show.
  function initFinalizeBackdropColor() {
    document.addEventListener('change', function (ev) {
      var select = ev.target;
      if (!(select instanceof HTMLSelectElement) || select.name !== 'backdrop') return;
      var form = select.closest('.finalize-form, .finalize-all-form');
      if (!form) return;
      var color = qs('input[name="backdrop_color"]', form);
      var on = select.value === 'color';
      color.hidden = !on;
      color.disabled = !on;
      if (on) color.focus();
    });
  }

  // repair_pad/repair_lora only mean anything alongside a repair region, so the worker never sees them stray in.
  function initFinalizeRepairPad() {
    document.addEventListener('change', function (ev) {
      var box = ev.target;
      if (!(box instanceof HTMLInputElement) || (box.name !== 'repair_hands' && box.name !== 'repair_feet')) return;
      var form = box.closest('.finalize-form, .finalize-all-form');
      if (!form) return;
      var hands = qs('input[name="repair_hands"]', form);
      var feet = qs('input[name="repair_feet"]', form);
      var disabled = !(hands.checked || feet.checked);
      qs('input[name="repair_pad"]', form).disabled = disabled;
      qs('input[name="repair_lora"]', form).disabled = disabled;
    });
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
    // backdrop is always sent and always meaningful, null included: null is the transparent choice.
    var parts = ['backdrop=' + (options.backdrop === null ? 'transparent' : options.backdrop)];
    Object.keys(options).forEach(function (key) {
      var value = options[key];
      if (key === 'backdrop' || value === false || value === null || value === undefined) return;
      if (value === true) {
        parts.push(key);
      } else if (Array.isArray(value)) {
        parts.push(key + '=' + value.join('+'));
      } else {
        parts.push(key + '=' + value);
      }
    });
    preview.textContent = '送信内容: ' + parts.join(', ');
  }

  function initFinalizePreview() {
    qsa('.finalize-form, .finalize-all-form').forEach(renderFinalizePreview);
    ['change', 'input'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        var form = ev.target.closest('.finalize-form, .finalize-all-form');
        if (!form) return;
        renderFinalizePreview(form);
      });
    });
  }

  function postFinalizeRequest(generationShortId, options) {
    return api('/api/v1/requests', 'POST', {
      kind: 'finalize',
      payload: { generation_id: generationShortId, options: options },
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

  // Finalize submit は積んだ直後 (queued) の行をその場に足すだけで、以後の running/done は
  // registerRequestElement 経由の initRequestLive が反映する (location.reload はしない)。
  function initFinalize() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.finalize-form');
      if (!form) return;
      ev.preventDefault();
      const shortId = form.getAttribute('data-generation-short-id');
      const options = finalizeOptionsFrom(form);
      if (!options) return;
      try {
        const request = await postFinalizeRequest(shortId, options);
        track('finalize.submit', Object.assign({ scope: 'one', generation_id: shortId }, options));
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
        upsertCardFinalizeBadge(shortId, request);
      } catch (e) {
        trackError('finalize.submit', e, { scope: 'one', generation_id: shortId });
        alert('finalize failed: ' + e.message);
      }
    });
  }

  // --- Finalize all arms (Batch Detail): 1 Generation につき1つのfinalize requestを順に積む ---
  function initFinalizeAll() {
    document.addEventListener('submit', async function (ev) {
      const form = ev.target.closest('.finalize-all-form');
      if (!form) return;
      ev.preventDefault();
      const idsAttr = form.getAttribute('data-generation-short-ids') || '';
      const ids = idsAttr.split(',').filter(function (id) { return id.length > 0; });
      const options = finalizeOptionsFrom(form);
      if (!options) return;
      try {
        const created = [];
        for (const shortId of ids) {
          created.push(await postFinalizeRequest(shortId, options));
        }
        track('finalize.submit', Object.assign({ scope: 'all', count: ids.length }, options));
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
        trackError('finalize.submit', e, { scope: 'all', count: ids.length });
        alert('finalize failed: ' + e.message);
      }
    });
  }

  // --- Viewer WebSocket (段階3 WorkerHub, docs/worker-protocol.md): /api/v1/requests/ws への
  // 接続を1本だけ共有する。requestLive (status/progress) と gallery live insertion
  // (generation) はどちらもこの上に message type ごとのハンドラを登録するだけで、ソケットの
  // 開閉・再接続 (1s→2s→4s…上限30s) は一箇所にまとめる。最初にどちらかが繋ぎに来た時点で開く。
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

  // --- Request live status: progress / status を受けて [data-request-id] 要素の表示を更新する
  // ([data-request-id]は .request-status-list の <li> と GenerationCard の finalize 進捗ピルの
  // 2種類。後者は setFinalizeBadgeText で組み立てを分ける)。ページ読み込み後に追加された要素
  // (finalize submit / Lightbox 再オープン / gallery live insertion で挿入したカード) も
  // registerRequestElement が都度登録し、まだ繋がっていなければソケットを開く。
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
      // 詳細取得に失敗してもstatusクラス自体は反映済みなので諦める
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

  // Finalize submitted from the Lightbox (docs/ui.md「Lightbox」): the underlying grid card
  // (Gallery / Bookmarks / Batch Detail, found by its .thumb-link[data-short-id]) gets the same
  // finalize badge the card fragment would render, in the queued state, live-updated from here on.
  function upsertCardFinalizeBadge(shortId, request) {
    var link = document.querySelector('.thumb-link[data-short-id="' + shortId + '"]');
    if (!link) return;
    var wrap = qs('.thumb-badges-top', link);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'thumb-badges-top';
      link.appendChild(wrap);
    }
    var badge = qs('.card-finalize-badge', wrap);
    if (!badge) {
      badge = document.createElement('span');
      wrap.appendChild(badge);
    }
    badge.className = 'card-finalize-badge request-status-' + request.status;
    badge.setAttribute('data-request-id', request.id);
    badge.setAttribute('data-request-status', request.status);
    badge.setAttribute('data-request-kind', request.kind);
    setFinalizeBadgeText(badge);
    registerRequestElement(badge);
  }

  // --- Gallery pending changes (docs/ui.md「Gallery pending changes」) ---
  // 新着 ('generation' メッセージ) と既定表示で bad にしたカードの非表示は、グリッドへ即座には
  // 反映しない。操作中のカードが手元で動かないよう、件数をグリッド直前の帯 (帯が見えない間は
  // ツールバー下に浮かぶピル) に出し、押したときにまとめて反映する。
  // queue は到着順 (古い→新しい) の { shortId, html }。
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
    var view = grid.getAttribute('data-gallery-view') || 'raw';
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

  function initGalleryPending() {
    if (!galleryGrid()) return;
    if (galleryLiveGrid()) viewerSocketConnect();
    window.addEventListener('scroll', updateGalleryPendingPill, { passive: true });
  }

  // --- Compare selection bar ---
  // Lightbox と Generation Detail の「比較に追加」ボタンが sessionStorage の compare set をトグルし、
  // Layout が全ページに置く #compare-bar がこの set を描画する (docs/ui.md「Compare entry」)。
  // 要素は { id, short_id }。short_id を持つのは、チップのサムネイルをカードと同じ画像 URL にして
  // ブラウザキャッシュを共有するため。
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
      img.src = '/g/' + encodeURIComponent(compareRef(entry)) + '/image';
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

  // --- A/B judge page ---
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

    // reveal.render_diff の各行を "column: baseline → arm" として一行にまとめる（delta付きの
    // エントリ、主に positive/negative は "column: <delta>" にする）。POST の 409（既に判定済み）
    // は response body を持たないので、この整形は成功時のみ通る。
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

  // --- Gallery filter form (src/ui/pages/Gallery.tsx .filter-form) ---
  // Fires on submit, before the normal GET navigation happens -- preventDefault
  // is intentionally not called.
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

  // --- Gallery / Bookmarks view switch + bad toggle (src/ui/components/ViewSwitch.tsx,
  // src/ui/pages/Gallery.tsx .bad-toggle) --- Fires on click, before the normal GET
  // navigation happens -- preventDefault is intentionally not called.
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

  // --- Gallery infinite scroll (src/ui/pages/Gallery.tsx .load-more) ---
  // Fetches the .load-more link's href with partial=1, appended as an HTML fragment
  // (cards + the next .load-more link, or nothing). loadMoreGalleryCards is shared with the
  // Lightbox's "next" navigation past the last loaded card (docs/ui.md「Lightbox」).
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

  // --- Lightbox (Gallery / Bookmarks / Batch Detail, docs/ui.md「Lightbox」) ---
  // A plain left-click on a card thumbnail opens this instead of navigating; modifier/middle
  // clicks and no-JS still follow the <a href="/g/{short_id}"> normally. The overlay chrome
  // (image, prev/next, topbar) is built once here; only .lightbox-panel's contents come from
  // the server fragment (GET /g/:short_id?partial=lightbox), so behaviour stays defined once
  // in the section components it shares with Generation Detail.
  var lightboxOverlay = null;
  var lightboxStage = null;
  var lightboxImage = null;
  var lightboxPanel = null;
  var lightboxPrevBtn = null;
  var lightboxNextBtn = null;
  var lightboxTopbarShortId = null;
  var lightboxTopbarDetailLink = null;
  var lightboxCurrentLink = null;
  var lightboxLastFocused = null;
  var lightboxLoadToken = 0;
  var lightboxPushedHistory = false;

  function ensureLightboxOverlay() {
    if (lightboxOverlay) return lightboxOverlay;
    const overlay = document.createElement('div');
    overlay.id = 'lightbox-overlay';
    overlay.className = 'lightbox-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="lightbox-topbar">' +
        '<button type="button" class="lightbox-close" aria-label="close"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg></button>' +
        '<span class="lightbox-topbar-short-id"></span>' +
        '<a class="lightbox-topbar-detail-link" href="#">詳細ページ ↗</a>' +
      '</div>' +
      '<div class="lightbox-stage">' +
        '<div class="lightbox-image-area">' +
          '<button type="button" class="lightbox-nav lightbox-prev" aria-label="prev">‹</button>' +
          '<img class="lightbox-image" alt="">' +
          '<button type="button" class="lightbox-nav lightbox-next" aria-label="next">›</button>' +
        '</div>' +
        '<div class="lightbox-panel"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    lightboxOverlay = overlay;
    lightboxStage = qs('.lightbox-stage', overlay);
    lightboxImage = qs('.lightbox-image', overlay);
    lightboxPanel = qs('.lightbox-panel', overlay);
    lightboxPrevBtn = qs('.lightbox-prev', overlay);
    lightboxNextBtn = qs('.lightbox-next', overlay);
    lightboxTopbarShortId = qs('.lightbox-topbar-short-id', overlay);
    lightboxTopbarDetailLink = qs('.lightbox-topbar-detail-link', overlay);

    // Swipe (narrow layout): horizontal = prev/next, vertical-down from the top of the scroll = close.
    var touchStartX = null;
    var touchStartY = null;
    var touchStartAtTop = false;
    var SWIPE_THRESHOLD = 50;
    lightboxStage.addEventListener(
      'touchstart',
      function (ev) {
        if (ev.touches.length !== 1) return;
        touchStartX = ev.touches[0].clientX;
        touchStartY = ev.touches[0].clientY;
        touchStartAtTop = lightboxStage.scrollTop === 0;
      },
      { passive: true },
    );
    lightboxStage.addEventListener(
      'touchend',
      function (ev) {
        if (touchStartX === null) return;
        var touch = ev.changedTouches[0];
        var dx = touch.clientX - touchStartX;
        var dy = touch.clientY - touchStartY;
        touchStartX = null;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
          lightboxNavigate(dx < 0 ? 1 : -1);
        } else if (dy > SWIPE_THRESHOLD && dy > Math.abs(dx) && touchStartAtTop) {
          closeLightbox();
        }
      },
      { passive: true },
    );

    // 画像・パネル・prev/next・トップバー以外のクリックで閉じる。押下も同じ背景で始まったときに
    // 限るのは、パネル内のテキスト選択を背景で離したときの click で閉じないようにするため。
    // document ではなく overlay で拾うのは、パネル内の委譲ハンドラが押された要素を DOM から
    // 外す前に判定するため。
    var LIGHTBOX_CONTENT = '.lightbox-image, .lightbox-panel, .lightbox-nav, .lightbox-topbar';
    var backdropPressed = false;
    overlay.addEventListener('pointerdown', function (ev) {
      backdropPressed = !ev.target.closest(LIGHTBOX_CONTENT);
    });
    overlay.addEventListener('click', function (ev) {
      var pressed = backdropPressed;
      backdropPressed = false;
      if (pressed && !ev.target.closest(LIGHTBOX_CONTENT)) closeLightbox();
    });

    return overlay;
  }

  function lightboxCardsInOrder() {
    return qsa('.thumb-link');
  }

  function lightboxFindByShortId(shortId) {
    var cards = lightboxCardsInOrder();
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getAttribute('data-short-id') === shortId) return cards[i];
    }
    return null;
  }

  function lightboxUpdateNavButtons() {
    if (!lightboxPrevBtn || !lightboxNextBtn) return;
    var cards = lightboxCardsInOrder();
    var idx = lightboxCurrentLink ? cards.indexOf(lightboxCurrentLink) : -1;
    lightboxPrevBtn.hidden = idx <= 0;
    var hasMoreLink = Boolean(qs('.load-more'));
    lightboxNextBtn.hidden = idx < 0 ? true : !(idx < cards.length - 1 || hasMoreLink);
  }

  async function lightboxNavigate(dir) {
    var cards = lightboxCardsInOrder();
    var idx = lightboxCurrentLink ? cards.indexOf(lightboxCurrentLink) : -1;
    if (idx < 0) return;
    var nextIdx = idx + dir;
    if (dir > 0 && nextIdx >= cards.length) {
      var link = qs('.load-more');
      if (!link) return;
      var loaded = await loadMoreGalleryCards(link);
      if (!loaded) return;
      cards = lightboxCardsInOrder();
    }
    var target = cards[nextIdx];
    if (!target) return;
    showLightbox(target.getAttribute('data-short-id'), target, 'replace');
  }

  // mode: 'push' (user opened a new image -- adds a history entry), 'replace' (navigating
  // within an already-open lightbox), or 'none' (syncing to an already-current #g= hash).
  function showLightbox(shortId, link, mode) {
    if (!shortId) return;
    ensureLightboxOverlay();
    // 狭い幅ではステージごと縦スクロールするので、別の画像に移ったら先頭 (画像) から見せる
    if (lightboxTopbarShortId.textContent !== shortId) lightboxStage.scrollTop = 0;
    lightboxCurrentLink = link || lightboxFindByShortId(shortId);
    if (!lightboxLastFocused) lightboxLastFocused = document.activeElement;
    document.body.classList.add('lightbox-open');
    lightboxOverlay.hidden = false;
    lightboxUpdateNavButtons();

    var img = lightboxCurrentLink ? qs('.thumb-fg', lightboxCurrentLink) : null;
    lightboxImage.src = img ? img.src : '/g/' + encodeURIComponent(shortId) + '/image';
    lightboxImage.alt = shortId;
    lightboxTopbarShortId.textContent = shortId;
    lightboxTopbarDetailLink.setAttribute('href', '/g/' + shortId);

    const token = ++lightboxLoadToken;
    fetch('/g/' + encodeURIComponent(shortId) + '?partial=lightbox')
      .then(function (res) {
        if (!res.ok) throw new Error('failed to load generation ' + shortId);
        return res.text();
      })
      .then(function (html) {
        if (token !== lightboxLoadToken) return;
        lightboxPanel.innerHTML = html;
        qsa('[data-request-id]', lightboxPanel).forEach(registerRequestElement);
        updateCompareBar();
      })
      .catch(function (e) {
        if (token !== lightboxLoadToken) return;
        trackError('lightbox.open', e, { short_id: shortId });
      });

    if (mode === 'push' || mode === 'replace') {
      const url = new URL(location.href);
      url.hash = 'g=' + encodeURIComponent(shortId);
      if (mode === 'push' && !lightboxPushedHistory) {
        history.pushState({ lightbox: true }, '', url);
        lightboxPushedHistory = true;
      } else {
        history.replaceState({ lightbox: true }, '', url);
      }
    }
  }

  function doCloseLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.hidden = true;
    document.body.classList.remove('lightbox-open');
    lightboxLoadToken++;
    lightboxCurrentLink = null;
    if (lightboxLastFocused && typeof lightboxLastFocused.focus === 'function') {
      try {
        lightboxLastFocused.focus();
      } catch (e) {}
    }
    lightboxLastFocused = null;
    lightboxPushedHistory = false;
  }

  // Manual close (X / Esc / backdrop) goes through history.back() only when this page pushed the
  // #g= entry, so the Back button and the close button agree; doCloseLightbox (called from the
  // popstate handler) does the DOM teardown. A lightbox restored from the URL on load has no
  // entry of ours to pop -- going back there would leave the page -- so it just drops the hash.
  function closeLightbox() {
    if (!lightboxOverlay || lightboxOverlay.hidden) return;
    if (lightboxPushedHistory) {
      history.back();
      return;
    }
    if (/(?:^|#)g=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    doCloseLightbox();
  }

  function initLightbox() {
    document.addEventListener('click', function (ev) {
      const link = ev.target.closest ? ev.target.closest('.thumb-link') : null;
      if (!link) return;
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      showLightbox(link.getAttribute('data-short-id'), link, 'push');
    });

    document.addEventListener('click', function (ev) {
      if (!lightboxOverlay) return;
      if (ev.target.closest && ev.target.closest('.lightbox-close')) {
        closeLightbox();
        return;
      }
      const prev = ev.target.closest ? ev.target.closest('.lightbox-prev') : null;
      if (prev) {
        lightboxNavigate(-1);
        return;
      }
      const next = ev.target.closest ? ev.target.closest('.lightbox-next') : null;
      if (next) {
        lightboxNavigate(1);
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && lightboxOverlay && !lightboxOverlay.hidden) closeLightbox();
    });

    window.addEventListener('popstate', function () {
      const match = /(?:^|#)g=([^&]+)/.exec(location.hash);
      if (match) {
        const shortId = decodeURIComponent(match[1]);
        showLightbox(shortId, lightboxFindByShortId(shortId), 'none');
      } else {
        doCloseLightbox();
      }
    });

    const initialMatch = /(?:^|#)g=([^&]+)/.exec(location.hash);
    if (initialMatch) {
      const shortId = decodeURIComponent(initialMatch[1]);
      showLightbox(shortId, lightboxFindByShortId(shortId), 'none');
    }
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
    initFinalize();
    initFinalizeAll();
    initFinalizeBackdropColor();
    initFinalizeRepairPad();
    initFinalizePreview();
    initGalleryFilter();
    initGalleryView();
    initGalleryInfiniteScroll();
    initGalleryPending();
    initLightbox();
    initRequestLive();
    initCompareBar();
    initCopyIdButtons();
    initCompareCols();
    initExperimentStatus();
    initAbJudge();
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
