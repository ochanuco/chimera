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
  --r-general: #4f8f6a;
  --r-sensitive: #f2c94c;
  --r-questionable: #ff7b80;
  --r-explicit: #d6383f;
  --graph-reference: #6fa8fd;
  --graph-relation: #e2914f;
  --graph-experiment: #c77dff;
  --nav-h: 3.25rem;
  --compare-bar-h: 3.75rem;
  --rail-w: 56px;
  --thumb-ar: 2 / 3;
  /* card-row の高さは固定（スケルトンと実カードを同じ寸法にするため。docs/ui.md「Gallery timeline」） */
  --card-id-h: 1.5rem;
  --card-rate-h: 1.5rem;
  --card-row-h: calc(0.9rem + 0.3rem + var(--card-id-h) + var(--card-rate-h));
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
.nav a { color: var(--text); font-weight: 600; white-space: nowrap; }
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
    padding: 0 0.6rem;
    gap: 0.4rem;
    font-size: 0.8rem;
  }
  .nav a.brand { margin-right: 0; }
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
h1 .detail-from { font-size: 0.8rem; font-weight: 400; color: var(--text-dim); }
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
/* Gallery / Bookmarks は 1 行 6 枚 */
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
.card-row { box-sizing: border-box; height: var(--card-row-h); padding: 0.4rem 0.55rem 0.5rem; display: flex; flex-direction: column; gap: 0.3rem; }
.card-id-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; height: var(--card-id-h); }
.card-row .rating-group { height: var(--card-rate-h); }
/* 読み込み前の枠。子要素を持たず、実カードと同じ外寸（サムネ + 固定高の card-row）を擬似要素で作る */
.card.card-skeleton::before { content: ''; display: block; aspect-ratio: var(--thumb-ar); background: var(--bg); }
.card.card-skeleton::after { content: ''; display: block; height: var(--card-row-h); }

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
.card-from-badge.copy-id-text { font-family: inherit; color: var(--graph-relation); padding: 0.05rem 0.4rem; }
.card-from-badge.copy-id-text:hover { color: var(--graph-relation); opacity: 0.85; }
.card-from-badge.copy-id-text.copied { color: var(--good); }
.card-from-badge-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card-from-badge-link { text-decoration: none; }
.card-from-badge-link:hover { text-decoration: none; opacity: 0.85; }

/* from-badge が無ければ request ピルのみがこの位置に来る (docs/ui.md「Gallery」) */
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
.card-request-badge {
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
.card-request-result { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

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
.safety-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(18, 18, 20, 0.86);
  border: 1px solid var(--border);
  white-space: nowrap;
}
.safety-badge-block { color: #fff; background: var(--r-explicit); border-color: var(--r-explicit); }
.safety-badge-sensitive { color: var(--r-questionable); border-color: var(--r-questionable); }
.safety-badge-caution { color: var(--r-sensitive); border-color: var(--r-sensitive); }
.safety-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0; font-size: 0.85rem; }
.safety-ok { color: var(--text-dim); }
.safety-row-label, .safety-label { color: var(--text-dim); }
.safety-unrated { color: var(--text-dim); font-size: 0.8rem; }
.safety-reasons { color: var(--r-questionable); font-size: 0.8rem; margin: 0; }
.safety-section { display: grid; gap: 0.8rem; min-width: 0; margin: 0.5rem 0; font-size: 0.85rem; }
.safety-head { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.safety-num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.rating-bar { display: flex; overflow: hidden; }
.rating-bar span { display: block; height: 100%; }
.rating-bar-stack { height: 14px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); }
.rating-bar-strip { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; z-index: 1; }
.rating-bar-mini { width: 6rem; height: 8px; border-radius: 3px; background: var(--bg); border: 1px solid var(--border); flex: none; }
.safety-legend { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 0.8rem; color: var(--text-dim); }
.safety-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
.safety-legend b { color: var(--text); font-weight: 600; }
.safety-gauges { display: grid; gap: 0.9rem; padding-top: 0.6rem; }
.safety-gauge { display: grid; grid-template-columns: 6.5em minmax(0, 1fr) 4em; align-items: center; gap: 0.6rem; font-size: 0.82rem; }
.safety-track { position: relative; height: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; }
.safety-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; }
.safety-tick { position: absolute; top: -5px; bottom: -5px; width: 2px; background: var(--text); opacity: 0.75; }
.safety-tick::after { content: attr(data-label); position: absolute; top: -17px; left: 50%; transform: translateX(-50%); font-size: 0.68rem; color: var(--text-dim); white-space: nowrap; }
.safety-gap { grid-column: 2 / 4; font-size: 0.75rem; color: var(--text-dim); margin-top: -0.35rem; }
.safety-gap.near { color: var(--r-sensitive); }
.safety-tags-title { margin-bottom: 0.4rem; }
.safety-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.safety-tag { border: 1px solid var(--border); border-radius: 4px; padding: 0.05rem 0.45rem; font-size: 0.78rem; background: var(--bg); }
.safety-tag .safety-num { color: var(--text-dim); margin-left: 4px; }
.safety-tag.hot { font-weight: 600; }
.safety-tag.risk-exposure, .safety-tag.risk-certain, .risk-key.risk-certain { border-color: var(--r-explicit); }
.safety-tag.risk-suspect, .risk-key.risk-suspect { border-color: var(--r-questionable); }
.safety-tag.risk-safe { color: var(--text-dim); }
.safety-tags-legend { margin-left: 0.6rem; font-size: 0.72rem; color: var(--text-dim); }
.risk-key { display: inline-block; border: 1px solid var(--border); border-radius: 4px; padding: 0 0.35rem; margin-left: 0.25rem; }
.card-safety-pct {
  position: absolute;
  right: 0.4rem;
  bottom: 0.4rem;
  z-index: 1;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 0.7rem;
  color: var(--text-dim);
  background: rgba(18, 18, 20, 0.86);
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.card:hover .card-safety-pct { opacity: 1; }
@media (hover: none) { .card-safety-pct { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .card-safety-pct { transition: none; } }
.safety-compare { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem 0.6rem; margin-top: 0.4rem; font-size: 0.78rem; }
.safety-delta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-dim); }
.safety-delta.down { color: var(--r-general); }
.safety-delta.up { color: var(--r-questionable); }
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
.card-id-actions { display: flex; align-items: center; gap: 0.3rem; }
.card-reroll-link { color: var(--text-dim); font-size: 0.95rem; line-height: 1; text-decoration: none; }
.card-reroll-link:hover { color: var(--accent); text-decoration: none; }

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
.rel-badge.rel-request { background: color-mix(in srgb, var(--text-dim) 22%, transparent); color: var(--text-dim); }
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

.load-more,
.load-newer {
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
.load-more:hover,
.load-newer:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }

/* Gallery タイムライン: 15 分枠の見出しはグリッドの全幅アイテム、右端に固定のレール (docs/ui.md「Gallery」) */
.container:has([data-gallery-grid]) { padding-right: calc(var(--rail-w) + 1rem); }
.gallery-date-header {
  grid-column: 1 / -1;
  position: sticky;
  top: var(--gallery-sticky-top, calc(var(--nav-h) + 3.5rem));
  z-index: 2;
  margin: 0 -4px;
  padding: 8px 4px;
  background: var(--bg);
  font-size: 0.95rem;
  font-weight: 700;
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.gallery-date-header small {
  color: var(--text-dim);
  font-weight: 400;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
}
.gallery-slot-header {
  grid-column: 1 / -1;
  margin-bottom: -0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
}
.gallery-slot-header b { color: var(--text); font-weight: 600; }

.gallery-rail {
  position: fixed;
  right: 0;
  top: var(--nav-h);
  bottom: 0;
  width: var(--rail-w);
  z-index: 12;
  touch-action: none;
  cursor: ns-resize;
  user-select: none;
}
body:has(#compare-bar:not(.hidden)) .gallery-rail { bottom: var(--compare-bar-h); }
/* レールがスクロールバーの役を持つので、ブラウザのスクロールバーは隠す（ホイール・キー・タッチのスクロールは残る） */
html:has(.gallery-rail) { scrollbar-width: none; }
html:has(.gallery-rail)::-webkit-scrollbar { display: none; }
.gallery-rail-track { position: absolute; inset: 14px 0; }
.gallery-rail-line { position: absolute; top: 0; bottom: 0; right: 14px; width: 2px; background: var(--border); border-radius: 1px; }
.gallery-rail-label {
  position: absolute;
  right: 22px;
  transform: translateY(-50%);
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
}
.gallery-rail-dot { position: absolute; right: 13px; width: 4px; height: 4px; border-radius: 50%; background: #4a4a55; transform: translateY(-50%); }
.gallery-rail-thumb {
  position: absolute;
  right: 6px;
  width: 18px;
  height: 32px;
  transform: translateY(-50%);
  border-radius: 9px;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(124, 156, 245, 0.18);
  opacity: 0.55;
  transition: opacity 0.15s;
}
.gallery-rail:hover .gallery-rail-thumb, .gallery-rail.dragging .gallery-rail-thumb { opacity: 1; }
.gallery-rail-bubble {
  position: absolute;
  right: calc(var(--rail-w) - 4px);
  transform: translateY(-50%);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  white-space: nowrap;
  display: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.gallery-rail-bubble b { display: block; font-size: 0.9rem; }
.gallery-rail-bubble span { color: var(--text-dim); font-size: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.gallery-rail:hover .gallery-rail-bubble, .gallery-rail.dragging .gallery-rail-bubble { display: block; }
.gallery-rail:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .gallery-rail-thumb { transition: none; } }
@media (max-width: 480px) {
  :root { --rail-w: 44px; }
  .gallery-rail-label { font-size: 0.65rem; }
}

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
  :root { --card-id-h: 2.75rem; --card-rate-h: 2.75rem; }
  .card-row .rate-btn { flex: 1; min-height: 2.75rem; display: flex; align-items: center; justify-content: center; }
  .card-row .card-id { min-height: 2.75rem; }
  .card-reroll-link { min-width: 2.75rem; min-height: 2.75rem; display: flex; align-items: center; justify-content: center; }
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

.dial-label { font-size: 0.8rem; color: var(--text-dim); margin-right: 0.2rem; }
.dof-tools { display: flex; align-items: center; gap: 0.5rem; flex-basis: 100%; font-size: 0.8rem; color: var(--text-dim); }
.dof-f-row { display: flex; align-items: center; gap: 0.4rem; }
/* The guide circle sits in a clip box so it never draws outside the picture. */
.dof-guide-clip { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.dof-guide-circle {
  position: absolute; box-sizing: border-box; border: 1px solid rgba(255, 255, 255, 0.9); border-radius: 50%;
  background: rgba(255, 255, 255, 0.06); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
/* White ring with a dark halo so the marker reads on both light and dark pictures. */
.dof-focus-marker {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.75), inset 0 0 0 1.5px rgba(0, 0, 0, 0.75);
  pointer-events: none;
}
.dof-focus-marker::before, .dof-focus-marker::after { content: ""; position: absolute; background: #fff; box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.75); }
.dof-focus-marker::before { left: 50%; top: -5px; bottom: -5px; width: 1px; margin-left: -0.5px; }
.dof-focus-marker::after { top: 50%; left: -5px; right: -5px; height: 1px; margin-top: -0.5px; }

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
.style-check-title { margin: 0; font-size: 1.1rem; }
.style-check-any-id { display: flex; gap: 0.4rem; }
.style-check-any-id input { width: 10rem; }


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

.compare-table-wrap { overflow: auto; max-height: 80vh; margin-top: 1.25rem; }
.compare-table { border-collapse: collapse; width: 100%; min-width: 480px; }
.compare-table th, .compare-table td {
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
}
.compare-table th { color: var(--text-dim); font-weight: 600; white-space: nowrap; }
.compare-table td:first-child { color: var(--text-dim); white-space: nowrap; }
/* 固定ヘッダ行・固定ラベル列。不透明背景がないとスクロール下のセルが透ける */
.compare-table thead th { position: sticky; top: 0; z-index: 2; background: var(--bg); box-shadow: inset 0 -1px 0 var(--border); }
.compare-table tbody td:first-child { position: sticky; left: 0; z-index: 1; background: var(--bg); box-shadow: inset -1px 0 0 var(--border); }
.compare-table thead th:first-child { left: 0; z-index: 3; }
#compare-main-wrap:not(.show-same) .compare-table tr.compare-same { display: none; }
.compare-change td { background: var(--bg-elevated); }
.compare-change td:first-child { color: var(--text); background: var(--bg-elevated); }
.compare-table .tok-del { background: rgba(212, 105, 95, 0.3); text-decoration: line-through; border-radius: 2px; }
.compare-table .tok-add { background: rgba(95, 191, 123, 0.3); border-radius: 2px; }
.cmp-patch + .cmp-patch { margin-top: 0.35rem; }
.cmp-patch-part { font-weight: 600; }
.cmp-patch-reason { color: var(--text-dim); font-size: 0.75rem; }
.compare-same-bar { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-dim); }
.compare-same-items { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 0.6rem; align-items: baseline; }
.compare-same-chip { font-family: ui-monospace, monospace; font-size: 0.75rem; white-space: nowrap; }
.compare-same-bar label { display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; }
.compare-prompts { margin-top: 1rem; }
.compare-prompts summary { cursor: pointer; font-size: 0.85rem; color: var(--text-dim); }
.compare-table td.diff {
  border-left: 3px solid var(--neutral);
  background: rgba(184, 171, 95, 0.07);
}
.compare-table .tok-uniq { background: rgba(95, 191, 123, 0.3); border-radius: 2px; }
.compare-table .tok-partial { background: rgba(184, 171, 95, 0.35); border-radius: 2px; }
.compare-legend { font-size: 0.75rem; color: var(--text-dim); margin: 0.75rem 0 0.25rem; }
/* Experiment Detail の Compare セクション（Run を列にした Compare 表、docs/ui.md「Experiment View」） */
.exp-compare { margin-bottom: 1.5rem; }
.exp-matrix-scroll { overflow-x: auto; }
.exp-matrix { border-collapse: separate; border-spacing: 0.5rem; }
.exp-matrix th { font-weight: 600; text-align: left; vertical-align: top; white-space: nowrap; }
.exp-matrix-seed { font-family: ui-monospace, monospace; color: var(--text-dim); font-size: 0.8rem; }
.exp-matrix-cell { width: 180px; min-width: 180px; vertical-align: top; }
.exp-matrix-empty .card { border-style: dashed; background: transparent; }
.exp-matrix-empty .exp-matrix-wait { display: flex; align-items: center; justify-content: center; aspect-ratio: var(--thumb-ar); color: var(--text-dim); }
.exp-matrix-empty .exp-matrix-wait-row { height: var(--card-row-h); }
.exp-compare-seeds { display: flex; flex-wrap: wrap; gap: 0.4rem 0.75rem; align-items: baseline; font-size: 0.85rem; color: var(--text-dim); }
.exp-compare-seed { font-family: ui-monospace, monospace; }
.exp-compare-seed.current { color: var(--text); }
.compare-col-label, .compare-head-label { font-weight: 600; margin-bottom: 0.25rem; }
.compare-head-pending { color: var(--text-dim); font-weight: 400; }
.compare-placeholder {
  display: flex; align-items: center; justify-content: center; aspect-ratio: 1; color: var(--text-dim);
  border: 1px dashed var(--border); border-radius: 6px;
}
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
.exp-run-request-link { font-size: 0.82rem; }

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

/* ---- ワークベンチ (/work, docs/ui.md「Workbench」) と フチ / ボケの共通部品 ---- */
.wb [hidden], .outline-editor [hidden], .dof-viewfinder [hidden] { display: none !important; }
.wb-pill {
  font: inherit;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 2.25rem;
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  text-decoration: none;
}
.wb-pill:hover:not(:disabled) { border-color: var(--accent); text-decoration: none; }
.wb-pill:disabled { opacity: 0.4; cursor: default; }
.wb-pill-on { background: var(--accent); border-color: var(--accent); color: #10131c; }
.wb-radio-pill { position: relative; display: inline-flex; }
.wb-radio-pill input { position: absolute; opacity: 0; pointer-events: none; }
.wb-radio-pill span {
  display: inline-flex; align-items: center; min-height: 2.25rem; padding: 0.3rem 0.8rem;
  border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elevated); cursor: pointer; font-size: 0.85rem;
}
.wb-radio-pill input:checked + span { background: var(--accent); border-color: var(--accent); color: #10131c; }
.wb-radio-pill input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.icon-btn {
  flex: none; width: 1.75rem; height: 1.75rem; display: inline-flex; align-items: center; justify-content: center; padding: 0;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); color: var(--text); cursor: pointer;
}
.icon-btn:disabled { opacity: 0.35; cursor: default; }

.compass { display: grid; grid-template-columns: repeat(3, 2.75rem); gap: 0.35rem; }
.compass-btn { width: 2.75rem; height: 2.75rem; min-height: 0; padding: 0; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 0.75rem; }
.compass-centre { display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: var(--text-dim); }
.outline-stroke .compass { grid-template-columns: repeat(3, 2.25rem); gap: 0.25rem; }
.outline-stroke .compass-btn { width: 2.25rem; height: 2.25rem; }

.outline-editor { display: flex; flex-direction: column; gap: 0.5rem; }
.outline-rows { display: flex; flex-direction: column; gap: 0.4rem; }
.outline-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; min-width: 0; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border); }
.outline-n { width: 0.9rem; font-size: 0.75rem; color: var(--text-dim); font-family: ui-monospace, monospace; }
.outline-color { flex: none; width: 2rem; height: 2rem; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elevated); }
.outline-width { order: 9; flex: 1 1 100%; min-width: 0; margin: 0; }
.outline-pct { flex: none; width: 3.4rem; margin-right: auto; text-align: left; white-space: nowrap; font-size: 0.72rem; font-family: ui-monospace, monospace; }
.outline-actions { display: flex; gap: 0.4rem; }
.outline-actions .wb-pill { flex: 1 1 0; }
.outline-stroke { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text-dim); }
.outline-stroke-compass { flex-basis: 100%; }
.outline-note { margin: 0; font-size: 0.78rem; color: var(--text-dim); }
.dof-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.9rem; margin: 0.3rem 0; padding: 0; border: 0; font-size: 0.85rem; }
.dof-scope legend { float: left; padding: 0; margin-right: 0.5rem; color: var(--text-dim); }
.dof-viewfinder { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; margin: 0.3rem 0; font-size: 0.85rem; }
.detail-workbench { margin: 0.6rem 0 0; }
.workbench-open-link {
  display: inline-block;
  padding: 0.5rem 1.1rem;
  border-radius: 6px;
  background: var(--accent);
  color: #10131c;
  font-weight: 600;
}
.workbench-open-link:hover { filter: brightness(1.12); text-decoration: none; }
.detail-workbench { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.reroll-open-link {
  display: inline-block;
  padding: 0.5rem 1.1rem;
  border-radius: 6px;
  border: 1px solid var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.reroll-open-link:hover { background: rgba(124, 156, 245, 0.15); text-decoration: none; }

.work-lead { margin: 0 0 1rem; color: var(--text-dim); max-width: 40rem; }
.work-filters { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
.work-filter-group { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.work-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.9rem; }
.work-source {
  display: flex; flex-direction: column; gap: 0.35rem; padding: 0.5rem; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text);
}
.work-source:hover { border-color: var(--accent); text-decoration: none; }
.work-source img { width: 100%; aspect-ratio: 2 / 3; object-fit: contain; border-radius: 6px; background: #000; }
.work-source-meta { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.work-source-id { font-family: ui-monospace, monospace; font-weight: 600; }
.work-rating { font-size: 0.75rem; padding: 0.05rem 0.5rem; border-radius: 999px; background: var(--border); color: var(--text); }
.work-state { font-size: 0.75rem; padding: 0.05rem 0.5rem; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); }
.work-state-done { border-color: var(--good); color: var(--good); }
.work-rating-good { background: var(--good); color: #0c1a10; }
.work-rating-bad { background: var(--bad); color: #200a08; }
.work-source-recipe { font-size: 0.75rem; color: var(--text-dim); font-family: ui-monospace, monospace; }
.work-pager { display: flex; gap: 0.5rem; margin-top: 1.25rem; }

.wb { display: flex; flex-direction: column; gap: 0.6rem; }
.wb-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; }
.wb-back { font-size: 0.85rem; }
.wb-steps-nav { flex: 1 1 24rem; min-width: 0; overflow-x: auto; }
.wb-steps { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 0.25rem; }
.wb-steps li { display: flex; align-items: center; gap: 0.25rem; flex: none; }
.wb-step-sep { color: var(--text-dim); font-size: 0.8rem; }
.wb-step {
  font: inherit; display: flex; flex-direction: column; align-items: flex-start; padding: 0.15rem 0.6rem; min-height: 2.25rem;
  border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer;
}
.wb-step:disabled { cursor: default; opacity: 0.5; }
.wb-step-label { font-size: 0.78rem; }
.wb-step-kind { font-size: 0.68rem; opacity: 0.75; }
.wb-step-on { background: var(--accent); border-color: var(--accent); color: #10131c; }
.wb-step-open:not(.wb-step-on) { border-style: dashed; }

.wb-main { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-start; }
.wb-compare { flex: 999 1 35rem; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.wb-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
.wb-fig { margin: 0; display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.wb-cap { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.25rem 0.5rem; min-height: 2.25rem; font-size: 0.78rem; color: var(--text-dim); }
.wb-cap-actions { display: flex; align-items: center; gap: 0.4rem; margin-left: auto; }
.wb-cap-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-dim); text-decoration: none; }
.wb-cap-link:hover { color: var(--accent); }
.wb-pane {
  position: relative; width: 100%; height: var(--wb-pane-h, calc(100vh - 18rem)); min-height: 14rem; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-elevated); overflow: hidden; user-select: none;
  display: flex; align-items: center; justify-content: center;
}
.wb-pane img, .wb-tile-pane img { width: 100%; height: 100%; object-fit: contain; display: block; -webkit-user-drag: none; }
.wb-checker { background: var(--checker); }
.wb-pane-active { cursor: crosshair; touch-action: none; }
.wb-empty, .wb-pending-note { padding: 1.5rem; text-align: center; font-size: 0.9rem; color: var(--text-dim); }
.wb-overlay { position: absolute; pointer-events: none; }
.wb-cross-x { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid rgba(255, 0, 140, 0.85); }
.wb-cross-y { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid rgba(255, 0, 140, 0.85); }
.wb-loupe {
  position: absolute; box-sizing: border-box; overflow: hidden; border-radius: 12px;
  border: 1.5px solid var(--border); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  background-repeat: no-repeat; pointer-events: none;
}
.wb-loupe-pixel { image-rendering: pixelated; }
.wb-loupe-cross { position: absolute; inset: 0; }
.wb-loupe-cross::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; border-left: 1px solid rgba(255, 0, 140, 0.85); }
.wb-loupe-cross::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid rgba(255, 0, 140, 0.85); }
.wb-rects { position: absolute; inset: 0; }
.wb-rect { position: absolute; border: 2px solid var(--accent); background: rgba(124, 156, 245, 0.2); box-sizing: border-box; }
.wb-rect-draft { border-style: dashed; }
.wb-focus { z-index: 1; }

.wb-all { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 0.5rem; }
.wb-tile {
  margin: 0; font: inherit; text-align: left; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.35rem;
  border-radius: 10px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text); cursor: pointer;
}
.wb-tile-input { outline: 2px solid var(--text-dim); cursor: default; }
.wb-tile-on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.wb-tile-pane { position: relative; width: 100%; aspect-ratio: 4 / 5; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.wb-tile-cap { font-size: 0.75rem; }
.wb-meta { color: var(--text-dim); font-size: 0.75rem; }

.wb-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.wb-strip { display: flex; gap: 0.25rem; overflow-x: auto; flex: 1 1 14rem; min-width: 0; padding: 0.15rem; }
.wb-mini { position: relative; flex: none; padding: 2px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elevated); cursor: pointer; }
.wb-mini-on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.wb-mini-thumb { width: 2.75rem; height: 3.5rem; border-radius: 4px; overflow: hidden; background: #000; }
.wb-mini-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.wb-mini-rate { display: block; height: 4px; margin-top: 2px; border-radius: 2px; }
.wb-mini-adopted { position: absolute; top: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg); }
.wb-mini-running { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.6); font-size: 0.8rem; color: var(--neutral); }
.wb-adopt {
  font: inherit; font-size: 0.9rem; font-weight: 700; min-height: 2.5rem; padding: 0 1rem; border: 0; border-radius: 10px;
  background: var(--accent); color: #10131c; cursor: pointer;
}
.wb-adopt:disabled { background: var(--border); color: var(--text-dim); cursor: not-allowed; }
.wb-done { margin: 0; padding: 0.5rem 0.8rem; border-radius: 8px; background: rgba(124, 156, 245, 0.15); font-size: 0.85rem; }

.wb-panel {
  flex: 1 1 18rem; min-width: 0; max-width: 380px; max-height: calc(100dvh - var(--wb-panel-top, 6rem) - 1.5rem); overflow: hidden;
  background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px;
  display: flex; flex-direction: column;
}
.wb-panel-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.8rem; }
/* The run button stays on the panel's bottom edge whichever phase scrolls above it. */
.wb-panel-foot {
  flex: none; position: sticky; bottom: 0; padding: 0.6rem 0.8rem; border-top: 1px solid var(--border);
  background: var(--bg-elevated); border-radius: 0 0 12px 12px; display: flex; flex-direction: column; gap: 0.5rem;
}
.wb-panel-title { margin: 0 0 0.15rem; font-size: 1.1rem; }
.wb-note { margin: 0; font-size: 0.8rem; color: var(--text-dim); }
.wb-unavailable { padding: 0.7rem; border-radius: 8px; background: rgba(184, 171, 95, 0.15); color: var(--text); font-size: 0.85rem; }
.wb-error { margin: 0; color: var(--bad); font-size: 0.85rem; }
.wb-form, .wb-form > [data-wb-form-body], .wb-form > [data-wb-method-panel], .wb-form > [data-wb-part-panel] { display: flex; flex-direction: column; gap: 0.7rem; }
.wb-pills, .wb-words { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.wb-field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: var(--text-dim); }
.wb-field select, .wb-field input[type="text"] {
  font: inherit; font-size: 0.9rem; min-height: 2.4rem; padding: 0 0.6rem; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); color: var(--text);
}
.wb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.wb-inline-field { display: flex; align-items: center; gap: 0.4rem; margin-left: auto; font-size: 0.85rem; color: var(--text-dim); }
.wb-inline-field select { font: inherit; min-height: 2.4rem; padding: 0 0.5rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); }
.wb-rect-row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; font-size: 0.85rem; }
.wb-acc { border: 1px solid var(--border); border-radius: 10px; }
.wb-acc > summary { cursor: pointer; min-height: 2.5rem; padding: 0.5rem 0.7rem; font-weight: 700; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; }
.wb-acc-sub { margin-left: auto; font-weight: 400; font-size: 0.75rem; color: var(--text-dim); font-family: ui-monospace, monospace; }
.wb-acc .outline-editor, .wb-acc-body { padding: 0 0.7rem 0.7rem; }
.wb-acc-body { display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.85rem; }
.wb-run {
  font: inherit; font-size: 0.95rem; font-weight: 700; width: 100%; min-height: 3rem; border: 0; border-radius: 10px;
  background: var(--accent); color: #10131c; cursor: pointer;
}
.wb-run:disabled { background: var(--border); color: var(--text-dim); cursor: not-allowed; }

@media (max-width: 900px) {
  .wb-main { flex-direction: column; align-items: stretch; }
  .wb-compare, .wb-panel { flex: none; max-width: none; width: 100%; }
  .wb-panel { max-height: none; overflow: visible; }
  .wb-panel-body { overflow: visible; padding-bottom: 6rem; }
  /* Stacked under the compare panes, a sticky foot would only appear after scrolling past them. */
  .wb-panel-foot {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; border-radius: 0;
    padding: 0.6rem 1rem calc(0.6rem + env(safe-area-inset-bottom));
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.25);
  }
  .wb-pane { height: auto; aspect-ratio: 4 / 5; min-height: 0; }
}
@media (max-width: 600px) {
  .wb-pair { grid-template-columns: minmax(0, 1fr); }
}

/* リロール: 左に元絵、右に候補 2x2。デスクトップでは盤全体の高さを JS (fitBoard) がビューポート下端に合わせる。 */
.reroll-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 0.5rem; height: calc(100vh - 12rem); min-height: 20rem; }
.reroll-original { grid-row: 1 / span 2; }
.reroll .wb-compare { flex: none; }
.reroll-tabs { margin-bottom: 0.5rem; }
.reroll-board .wb-fig { min-height: 0; }
.reroll-board .wb-cap { min-height: 2.25rem; }
.reroll-board .wb-cap-actions { flex-wrap: wrap; }
.reroll-board .wb-pane { flex: 1 1 0; height: auto; min-height: 0; }
.reroll-board .wb-rating .rate-btn { padding: 0 0.35rem; }
@media (max-width: 900px) {
  .reroll-board { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: none; height: auto; min-height: 0; }
  .reroll-original { grid-column: 1 / -1; grid-row: auto; }
  .reroll-board .wb-pane { flex: none; height: auto; aspect-ratio: 4 / 5; }
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
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const el = ev.target.closest ? ev.target.closest('span.copy-id-btn[role="button"]') : null;
      if (!el) return;
      ev.preventDefault();
      el.click();
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

  function initCompareSame() {
    const toggle = document.getElementById('compare-show-same');
    const wrap = document.getElementById('compare-main-wrap');
    if (!toggle || !wrap) return;
    const STORE_KEY = 'chimera-compare-show-same';
    function apply(show) {
      toggle.checked = show;
      wrap.classList.toggle('show-same', show);
    }
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { /* localStorage unavailable */ }
    apply(stored === '1');
    toggle.addEventListener('change', function () {
      apply(toggle.checked);
      try { localStorage.setItem(STORE_KEY, toggle.checked ? '1' : '0'); } catch (e) { /* localStorage unavailable */ }
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
        document.dispatchEvent(new CustomEvent('chimera:rating', { detail: { id: id, rating: next } }));
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
      var safetyVerdict = section ? section.getAttribute('data-safety-verdict') : null;
      if (safetyVerdict === 'block' && !confirm('この画像は「出さない」判定です（露出表現の疑い）。それでも公開を記録しますか？')) return;
      try {
        var publication = await api('/api/v1/generations/' + generationId + '/publications', 'POST', { url: url || null });
        var list = qs('.publication-list', section);
        if (list && !list.querySelector('[data-publication-id="' + publication.id + '"]')) {
          list.insertBefore(publicationRow(publication), list.firstChild);
        }
        updatePublicationStatus(section, list ? list.children.length : 1);
        input.value = '';
        if (publication.warning && publication.warning.verdict === 'sensitive') {
          alert('センシティブ判定です。X では「センシティブな内容を含む」設定を付けて投稿してください。');
        }
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

  // ---- フチ (outline list) editor ----
  function outlineRows(editor) {
    return qsa('[data-outline-row]', editor);
  }

  function outlineNumberLabel(width) {
    return String(Number(Number(width).toFixed(2)));
  }

  function renumberOutlineRows(editor) {
    var rows = outlineRows(editor);
    rows.forEach(function (row, i) {
      qs('.outline-n', row).textContent = String(i + 1);
      qs('[data-outline-up]', row).disabled = i === 0;
      qs('[data-outline-down]', row).disabled = i === rows.length - 1;
    });
    var max = Number(editor.getAttribute('data-outline-max-count')) || 6;
    qs('[data-outline-add]', editor).disabled = rows.length >= max;
    qs('[data-outline-stroke]', editor).hidden = rows.length === 0;
    var summary = editor.closest('details') ? qs('[data-wb-outline-summary]', editor.closest('details')) : null;
    if (summary) summary.textContent = outlineSummaryText(editor);
  }

  var OUTLINE_COLOR_NAMES = { '#ffffff': '白', '#885b80': '紫' };

  // e.g. 「白 0.8 + 紫 3」; a directional shading is appended, an even one is the unremarkable default.
  function outlineSummaryText(editor) {
    var list = outlinesFrom(editor);
    if (list.length === 0) return 'なし';
    var text = list.map(function (o) {
      return (OUTLINE_COLOR_NAMES[o.color.toLowerCase()] || o.color) + ' ' + outlineNumberLabel(o.width);
    }).join(' + ');
    var stroke = outlineStrokeValue(editor);
    return stroke === 'even' ? text : text + ' · 陰影 ' + stroke;
  }

  function addOutlineRow(editor, color, width) {
    var template = qs('[data-outline-row-template]', editor);
    var row = template.content.firstElementChild.cloneNode(true);
    qs('[data-outline-color]', row).value = color;
    var range = qs('[data-outline-width]', row);
    range.value = String(width);
    qs('[data-outline-pct]', row).textContent = outlineNumberLabel(range.value) + '%';
    qs('[data-outline-rows]', editor).appendChild(row);
  }

  function setOutlineList(editor, list) {
    qs('[data-outline-rows]', editor).textContent = '';
    list.forEach(function (o) { addOutlineRow(editor, o.color, o.width); });
    renumberOutlineRows(editor);
  }

  function outlineDefaults(editor) {
    try { return JSON.parse(editor.getAttribute('data-outline-default') || '[]'); } catch (e) { return []; }
  }

  // [{color, width}, ...] inside -> outside, as the deliver option wants it.
  function outlinesFrom(editor) {
    return outlineRows(editor).map(function (row) {
      return { color: qs('[data-outline-color]', row).value, width: Number(qs('[data-outline-width]', row).value) };
    });
  }

  function outlineStrokeValue(editor) {
    return qs('[data-outline-stroke]', editor).getAttribute('data-value') || 'even';
  }

  function setOutlineStroke(editor, value) {
    var box = qs('[data-outline-stroke]', editor);
    var dir = value !== 'even';
    box.setAttribute('data-value', value);
    qsa('[data-stroke-mode]', box).forEach(function (b) {
      b.classList.toggle('wb-pill-on', (b.getAttribute('data-stroke-mode') === 'dir') === dir);
    });
    qs('[data-outline-stroke-compass]', box).hidden = !dir;
    if (dir) setCompassValue(qs('[data-compass="stroke"]', box), value);
    renumberOutlineRows(editor);
  }

  function setCompassValue(compass, value) {
    compass.setAttribute('data-value', value);
    qsa('[data-compass-dir]', compass).forEach(function (b) {
      var on = b.getAttribute('data-compass-dir') === value;
      b.classList.toggle('wb-pill-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initOutlineEditors() {
    qsa('[data-outline-editor]').forEach(renumberOutlineRows);
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target : null;
      if (!t) return;
      var editor = t.closest('[data-outline-editor]');
      if (!editor) return;
      var row = t.closest('[data-outline-row]');
      if (t.closest('[data-outline-add]')) {
        if (outlineRows(editor).length >= (Number(editor.getAttribute('data-outline-max-count')) || 6)) return;
        addOutlineRow(editor, '#d9c6ee', 0.8);
      } else if (t.closest('[data-outline-reset]')) {
        setOutlineList(editor, outlineDefaults(editor));
        setOutlineStroke(editor, editor.getAttribute('data-stroke-default') || 'even');
        return;
      } else if (row && t.closest('[data-outline-remove]')) {
        row.remove();
      } else if (row && t.closest('[data-outline-up]')) {
        if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      } else if (row && t.closest('[data-outline-down]')) {
        if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      } else if (t.closest('[data-stroke-mode]')) {
        var mode = t.closest('[data-stroke-mode]').getAttribute('data-stroke-mode');
        var current = qs('[data-compass="stroke"]', editor).getAttribute('data-value') || 'nw';
        setOutlineStroke(editor, mode === 'dir' ? current : 'even');
        return;
      } else if (t.closest('[data-compass="stroke"] [data-compass-dir]')) {
        setOutlineStroke(editor, t.closest('[data-compass-dir]').getAttribute('data-compass-dir'));
        return;
      } else {
        return;
      }
      renumberOutlineRows(editor);
    });
    document.addEventListener('input', function (ev) {
      var range = ev.target;
      if (!(range instanceof HTMLInputElement) || !range.hasAttribute('data-outline-width')) return;
      var pct = qs('[data-outline-pct]', range.closest('[data-outline-row]'));
      if (pct) pct.textContent = outlineNumberLabel(range.value) + '%';
      renumberOutlineRows(range.closest('[data-outline-editor]'));
    });
    document.addEventListener('input', function (ev) {
      var color = ev.target;
      if (color instanceof HTMLInputElement && color.hasAttribute('data-outline-color')) renumberOutlineRows(color.closest('[data-outline-editor]'));
    });
  }

  // State keyed by the form itself in a WeakMap, since a set
  // of rectangles has no single DOM home; redrawOptionsFrom reads it back via regionsFor(form).
  var repairRegionState = new WeakMap(); // form -> { img, overlay, regions: [[x0,y0,x1,y1], ...] }

  function regionsFor(form) {
    var state = repairRegionState.get(form);
    return state ? state.regions : [];
  }

  function dofSlider(form) {
    return qs('input[name="dof_f_stop"]', form);
  }

  function dofScopeFrom(root) {
    return {
      figure: qs('input[name="dof_scope_figure"]', root).checked,
      outline: qs('input[name="dof_scope_outline"]', root).checked,
      backdrop: qs('input[name="dof_scope_backdrop"]', root).checked,
    };
  }

  function dofViewfinderFrom(root) {
    var checked = qs('input[name="dof_viewfinder"]:checked', root);
    return checked ? checked.value : 'off';
  }

  function lightSceneSelect(form) {
    return qs('select[name="light_scene"]', form);
  }

  function lightFromSelect(form) {
    return qs('select[name="light_from"]', form);
  }

  function dofStopsFor(form) {
    var slider = dofSlider(form);
    if (!slider) return [];
    try { return JSON.parse(slider.getAttribute('data-dof-stops') || '[]'); } catch (e) { return []; }
  }

  function dofFNumber(form) {
    var slider = dofSlider(form);
    var stops = dofStopsFor(form);
    return slider && stops.length > 0 ? stops[Number(slider.value)] : undefined;
  }

  function redrawMethod(form) {
    var checked = qs('input[name="redraw_method"]:checked', form);
    return checked ? checked.value : 'canvas';
  }

  // worker-protocol.md「redraw」: exactly one method per request. Blank fields are omitted so the
  // recipe default applies. Returns null when the form can't become options.
  function redrawOptionsFrom(form) {
    var method = redrawMethod(form);
    if (method === 'hires') {
      var hires = { method: 'hires', hires: Number(qs('select[name="hires"]', form).value) };
      var hiresDenoise = qs('input[name="hires_denoise"]', form).value;
      if (hiresDenoise !== '') hires.denoise = Number(hiresDenoise);
      return hires;
    }
    if (method === 'light') {
      return { method: 'light', scene: qs('select[name="light_scene"]', form).value, from: lightFromSelect(form).value };
    }
    var options = { method: 'canvas' };
    var denoiseFromDial = dialGroupValue(form, 'denoise');
    if (denoiseFromDial === undefined) {
      var denoiseRaw = qs('input[name="denoise"]', form).value;
      if (denoiseRaw !== '') options.denoise = Number(denoiseRaw);
    } else if (denoiseFromDial !== null) {
      options.denoise = denoiseFromDial;
    }
    var sizeRaw = qs('input[name="size"]', form).value;
    if (sizeRaw !== '') options.size = Number(sizeRaw);
    var route = qs('select[name="route"]', form).value;
    if (route !== '') options.route = route;
    var regions = regionsFor(form);
    if (regions.length > 0) {
      options.keep_regions = regions;
      var keepStrengthRaw = qs('input[name="keep_strength"]', form).value;
      if (keepStrengthRaw !== '') options.keep_strength = Number(keepStrengthRaw);
    }
    return options;
  }

  // worker-protocol.md「deliver」. Returns null when the form can't become options; quiet mode
  // (used by the preview) silences the alert on a malformed backdrop colour. Every control is optional
  // so the workbench's slimmer deliver form can share it.
  function deliverOptionsFrom(form, quiet) {
    var checkbox = function (name) { var el = qs('input[name="' + name + '"]', form); return el ? el.checked : false; };
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

    var keepLegwearFromDial = dialGroupValue(form, 'keep_legwear');
    var keepLegwear = keepLegwearFromDial === undefined
      ? (checkbox('keep_legwear') ? true : null)
      : keepLegwearFromDial;

    var options = {
      repin: checkbox('repin'),
      recolor: checkbox('recolor'),
      keep_legwear: keepLegwear,
      backdrop: backdrop,
    };
    if (qs('input[name="skin"]', form)) options.skin = checkbox('skin');
    if (qs('input[name="keep_scene"]', form)) options.keep_scene = checkbox('keep_scene');

    var sizeSelect = qs('select[name="wb_deliver_size"]', form);
    if (sizeSelect) options.deliver_size = Number(sizeSelect.value);

    var editor = qs('[data-outline-editor]', form);
    if (editor) {
      options.outlines = outlinesFrom(editor);
      if (options.outlines.length > 0) options.stroke_light = outlineStrokeValue(editor);
    }

    // A light scene given here carries its own direction.
    var lightScene = lightSceneSelect(form);
    if (lightScene && lightScene.value !== '') options.light = { scene: lightScene.value, from: lightFromSelect(form).value };
    return options;
  }

  // The color input stays disabled while hidden so the browser's pattern check
  // cannot block submit on a control it has no way to show.
  function syncBackdropSummary(form) {
    var summary = qs('[data-wb-backdrop-summary]', form);
    var checked = qs('input[name="backdrop"]:checked', form);
    var label = checked ? qs('.backdrop-option-label', checked.closest('label')) : null;
    if (summary) summary.textContent = label ? label.textContent : '';
  }

  function syncBackdropColor(form) {
    var checked = qs('input[name="backdrop"]:checked', form);
    var color = qs('input[name="backdrop_color"]', form);
    if (!color) return;
    var on = !!checked && checked.value === 'color';
    color.hidden = !on;
    color.disabled = !on;
    syncBackdropSummary(form);
  }

  function postOptionRequest(kind, generationShortId, options, profile, idempotencyKey) {
    var payload = { generation_id: generationShortId, options: options };
    if (profile) payload.profile = profile;
    return api('/api/v1/requests', 'POST', {
      kind: kind,
      payload: payload,
      idempotency_key: idempotencyKey || ('gui:' + kind + ':' + generationShortId + ':' + crypto.randomUUID()),
      created_by: 'gui',
    });
  }

  // Same <li> markup RequestSection (src/ui/components/RequestSection.tsx) renders server-side.
  function requestStatusRow(request, showCreatedAt) {
    var li = document.createElement('li');
    li.className = 'request-status-' + request.status;
    li.setAttribute('data-request-id', request.id);
    li.setAttribute('data-request-status', request.status);
    var kind = document.createElement('span');
    kind.className = 'request-kind';
    kind.textContent = requestKindLabel(request.kind);
    li.appendChild(kind);
    li.appendChild(document.createTextNode(' ' + request.status + ' '));
    var progress = document.createElement('span');
    progress.className = 'request-progress';
    li.appendChild(progress);
    if (showCreatedAt && request.created_at) li.appendChild(document.createTextNode(' · ' + request.created_at));
    return li;
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

  // 絵柄チェック (/check): ワークベンチと同じ比較ペイン (wbViewer) に、左 = pin (または任意の ID)、右 = そのポーズの最新の plain render を出す。
  function initStyleCheck() {
    var root = qs('[data-style-check]');
    if (!root) return;
    var initial = {};
    try { initial = JSON.parse(root.getAttribute('data-initial') || '{}'); } catch (e) { initial = {}; }
    var recipe = root.getAttribute('data-recipe');
    var sc = { poses: initial.poses || [], active: 0, override: null, cursor: null, loupe: { on: true, zoom: 3 }, timer: null };
    var viewer = wbViewer(root, sc);
    viewer.trackCursor();

    var wanted = new URLSearchParams(location.search).get('pose');
    sc.poses.forEach(function (p, i) { if (p.pose === wanted) sc.active = i; });

    function current() {
      return sc.poses[sc.active] || null;
    }

    function hint(p) {
      if (!p.pin) return 'pin 無し';
      if (!p.request) return '未描画';
      if (p.request.status === 'done' && !p.result) return 'done';
      return p.request.status;
    }

    function setEmpty(pane, text) {
      pane.setAttribute('data-wb-key', 'none');
      pane.removeAttribute('data-wb-imgpane');
      pane.textContent = '';
      pane.classList.remove('wb-checker');
      pane.appendChild(wbEl('div', 'wb-empty', text));
    }

    function render() {
      var p = current();
      qsa('[data-sc-pose]', root).forEach(function (btn, i) {
        btn.classList.toggle('wb-step-on', i === sc.active);
        qs('[data-sc-hint]', btn).textContent = hint(sc.poses[i]);
      });
      if (!p) return;

      var left = sc.override || p.pin;
      var leftPane = qs('[data-wb-input-pane]', root);
      if (left) viewer.fillPane(leftPane, left.id, 'input', left, null);
      else setEmpty(leftPane, 'pin 無し');
      qs('[data-sc-left-cap]', root).textContent = left ? captionWithMeta((sc.override ? '比較 ' : 'pin ') + left.short_id, left) : 'pin';
      qs('[data-sc-left-reset]', root).hidden = !sc.override;

      var rightPane = qs('[data-wb-cmp-pane]', root);
      var rating = qs('[data-wb-rating]', root);
      if (p.result) {
        viewer.fillPane(rightPane, p.result.id, 'cmp', p.result, null);
        qs('[data-sc-right-cap]', root).textContent = captionWithMeta('最新 ' + p.result.short_id, p.result);
        rating.setAttribute('data-generation-id', p.result.id);
        applyRatingToGroups(p.result.id, p.result.rating);
      } else {
        var message = !p.pin ? '' : !p.request ? '未描画。「今の既定で描く」で積みます。'
          : p.request.status === 'queued' ? '待機中…' : p.request.status === 'running' ? '処理中…'
          : p.request.status === 'failed' ? '失敗: ' + (p.request.error || '') : p.request.status;
        setEmpty(rightPane, message);
        qs('[data-sc-right-cap]', root).textContent = '最新' + (p.request ? ' ' + p.request.status : '');
      }
      rating.hidden = !p.result;

      qs('[data-sc-replace-pin]', root).disabled = !(p.pin && p.result && p.pin.id !== p.result.id);
      var link = qs('[data-sc-compare-link]', root);
      link.hidden = !(p.pin && p.result);
      if (!link.hidden) link.href = '/compare?ids=' + encodeURIComponent(p.pin.short_id) + ',' + encodeURIComponent(p.result.short_id);
      viewer.updateCrosshair();
    }

    function selectPose(i) {
      sc.active = i;
      sc.override = null;
      var url = new URL(location.href);
      url.searchParams.set('pose', sc.poses[i].pose);
      history.replaceState(null, '', url);
      render();
    }

    function nodeOf(g) {
      return { id: g.id, short_id: g.short_id, rating: g.rating || null, delivered: false, image_width: g.image_width, image_height: g.image_height, image_size: g.image_size };
    }

    async function syncRequests() {
      var pending = sc.poses.filter(function (p) { return p.request && (p.request.status === 'queued' || p.request.status === 'running' || (p.request.status === 'done' && !p.result)); });
      if (pending.length === 0) {
        clearInterval(sc.timer);
        sc.timer = null;
        return;
      }
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        try {
          var r = await api('/api/v1/requests/' + encodeURIComponent(p.request.id));
          p.request.status = r.status;
          p.request.error = r.error || null;
          var id = r.status === 'done' && r.result && r.result.generation_ids ? r.result.generation_ids[0] : null;
          if (id) p.result = nodeOf(await api('/api/v1/generations/' + encodeURIComponent(id)));
        } catch (e) { /* retry on the next tick */ }
      }
      render();
    }

    function startPolling() {
      if (!sc.timer) sc.timer = setInterval(syncRequests, 3000);
    }

    root.addEventListener('click', async function (ev) {
      var t = ev.target.closest ? ev.target : null;
      if (!t) return;
      var poseBtn = t.closest('[data-sc-pose]');
      if (poseBtn) {
        var idx = sc.poses.findIndex(function (p) { return p.pose === poseBtn.getAttribute('data-sc-pose'); });
        if (idx >= 0) selectPose(idx);
        return;
      }
      if (t.closest('[data-sc-left-reset]')) {
        sc.override = null;
        return render();
      }
      var renderBtn = t.closest('[data-style-check-render]');
      if (renderBtn) {
        var label = renderBtn.textContent;
        renderBtn.disabled = true;
        renderBtn.textContent = 'Queueing…';
        try {
          var result = await api('/api/v1/style-check/' + encodeURIComponent(recipe), 'POST');
          (result.results || []).forEach(function (item) {
            var p = sc.poses.find(function (q) { return q.pose === item.pose; });
            if (!p || item.skipped || (!item.created && item.status === 'done')) return;
            p.request = { id: item.request_id, status: item.status, error: null };
            p.result = null;
          });
          render();
          startPolling();
          track('style_check.render', { recipe: recipe });
        } catch (e) {
          trackError('style_check.render', e, { recipe: recipe });
          alert('style check render failed: ' + e.message);
        } finally {
          renderBtn.disabled = false;
          renderBtn.textContent = label;
        }
        return;
      }
      if (t.closest('[data-sc-replace-pin]')) {
        var q = current();
        if (!q || !q.result) return;
        if (!confirm(q.pose + ' の pin を ' + q.result.short_id + ' に差し替えます。以後の絵柄チェックはこの絵の seed で描きます。')) return;
        try {
          await api('/api/v1/generations/' + q.result.id + '/pose-reference', 'POST', {});
          q.pin = q.result;
          sc.override = null;
          render();
          track('pose_reference.set', { generation_id: q.result.id, from: 'style_check' });
        } catch (e) {
          trackError('pose_reference.set', e, { generation_id: q.result.id });
          alert('failed to set pose reference: ' + e.message);
        }
      }
    });

    root.addEventListener('submit', async function (ev) {
      var form = ev.target.closest ? ev.target.closest('[data-sc-any-id]') : null;
      if (!form) return;
      ev.preventDefault();
      var id = form.elements.id.value.trim();
      if (!id) return;
      try {
        sc.override = nodeOf(await api('/api/v1/generations/' + encodeURIComponent(id)));
        form.elements.id.value = '';
        render();
      } catch (e) {
        alert('その ID の絵がありません: ' + id);
      }
    });

    document.addEventListener('chimera:rating', function (ev) {
      sc.poses.forEach(function (p) {
        [p.pin, p.result].forEach(function (n) { if (n && n.id === ev.detail.id) n.rating = ev.detail.rating; });
      });
      if (sc.override && sc.override.id === ev.detail.id) sc.override.rating = ev.detail.rating;
    });

    render();
    startPolling();
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

  // [data-request-id] は .request-status-list の <li> と GenerationCard の request 進捗ピルの
  // 2 種（後者は setRequestBadgeText が担当）。動的に追加された要素も registerRequestElement が
  // 都度登録し、未接続ならソケットを開く。
  var requestLive = { byId: {} };

  function isRequestBadge(el) {
    return el.classList.contains('card-request-badge');
  }

  // kind 表示ラベル。src/ui/components/OptionControls.tsx の REQUEST_KIND_LABELS と同じ規則。
  function requestKindLabel(kind) {
    var labels = { redraw: '描き直し', deliver: '納品', dof: 'ボケ', repair: 'repair', masked_redraw: 'masked redraw', finalize: 'finalize' };
    return labels[kind] || kind || '';
  }

  // GenerationCard.tsx の RequestBadge が組む構造と同じテキストを再現する。extra.step/total は
  // running中のprogressメッセージから、extra.resultShortId はdone確定後のresult取得から渡す。
  function setRequestBadgeText(el, extra) {
    var kind = el.getAttribute('data-request-kind');
    var status = el.getAttribute('data-request-status');
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(document.createTextNode(requestKindLabel(kind) + ' · '));
    if (status === 'running') {
      var text = 'running';
      if (extra && typeof extra.step === 'number' && typeof extra.total === 'number') {
        text += ' ' + extra.step + '/' + extra.total;
      }
      el.appendChild(document.createTextNode(text));
    } else if (status === 'done') {
      el.appendChild(document.createTextNode('done → '));
      var code = document.createElement('span');
      code.className = 'card-request-result';
      code.textContent = (extra && extra.resultShortId) || '';
      el.appendChild(code);
    } else {
      el.appendChild(document.createTextNode(status || ''));
    }
  }

  function requestLiveApplyProgress(p) {
    var el = requestLive.byId[p.request_id];
    if (!el) return;
    if (isRequestBadge(el)) {
      if (el.getAttribute('data-request-status') === 'running') {
        setRequestBadgeText(el, { step: p.step, total: p.total });
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

    if (isRequestBadge(el)) {
      setRequestBadgeText(el);
      if (s.status !== 'done') return;
      try {
        var badgeDetail = await api('/api/v1/requests/' + s.request_id, 'GET');
        if (badgeDetail.result && badgeDetail.result.generation_ids && badgeDetail.result.generation_ids[0]) {
          var badgeGen = await api('/api/v1/generations/' + badgeDetail.result.generation_ids[0], 'GET');
          setRequestBadgeText(el, { resultShortId: badgeGen.short_id });
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
  // 初回のカード取得が飛んでいる short_id。値は、その間に safety が届いたか。
  var galleryCardsInFlight = new Map();

  function galleryGrid() {
    return document.querySelector('[data-gallery-grid]');
  }

  function galleryLiveGrid() {
    var grid = galleryGrid();
    return grid && grid.getAttribute('data-gallery-live') === 'true' ? grid : null;
  }

  // bad=1 でも ids= でもない /gallery の既定表示だけ。Bookmarks には属性が無い。
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
    reflowGalleryHeaders(grid);
    fillGalleryCounts(grid);
    if (newCount > 0) scheduleGalleryTimelineRefresh();
    scheduleGalleryFill();
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

    if (galleryCardsInFlight.has(msg.short_id)) return;
    galleryCardsInFlight.set(msg.short_id, false);
    fetchGalleryCard(msg.short_id)
      .then(function (html) {
        if (!galleryLiveGrid() || galleryPendingQueued(msg.short_id)) return;
        galleryPending.queue.push({ shortId: msg.short_id, html: html });
        updateGalleryPendingUi();
      })
      .catch(function (e) {
        trackError('gallery.new_arrivals', e, { short_id: msg.short_id });
      })
      .then(function () {
        var stale = galleryCardsInFlight.get(msg.short_id);
        galleryCardsInFlight.delete(msg.short_id);
        if (stale) handleSafetyMessage({ short_id: msg.short_id });
      });
  }

  viewerSocketOn('generation', handleGenerationMessage);

  function fetchGalleryCard(shortId) {
    return fetch('/g/' + encodeURIComponent(shortId) + '?partial=card').then(function (res) {
      if (!res.ok) throw new Error('card fetch failed: ' + res.status);
      return res.text();
    });
  }

  // 判定は 'generation' の数秒後に保存されるので、カードを取得し直してバッジを出す。
  function handleSafetyMessage(msg) {
    var grid = galleryLiveGrid();
    if (!grid) return;
    var shortId = msg.short_id;
    if (galleryCardsInFlight.has(shortId)) {
      galleryCardsInFlight.set(shortId, true);
      return;
    }
    if (galleryPendingQueued(shortId)) {
      fetchGalleryCard(shortId)
        .then(function (html) {
          galleryPending.queue.forEach(function (item) {
            if (item.shortId === shortId) item.html = html;
          });
        })
        .catch(function (e) {
          trackError('gallery.safety_refresh', e, { short_id: shortId });
        });
      return;
    }
    var link = grid.querySelector('.thumb-link[data-short-id="' + shortId + '"]');
    var oldCard = link ? link.closest('.card') : null;
    if (!oldCard) return;
    fetchGalleryCard(shortId)
      .then(function (html) {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        var card = wrapper.querySelector('.card');
        if (!card || !oldCard.isConnected) return;
        if (oldCard.classList.contains('card-pending-hide')) card.classList.add('card-pending-hide');
        oldCard.replaceWith(card);
        qsa('[data-request-id]', card).forEach(registerRequestElement);
      })
      .catch(function (e) {
        trackError('gallery.safety_refresh', e, { short_id: shortId });
      });
  }

  viewerSocketOn('safety', handleSafetyMessage);

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
    if (group.request && group.request.short_id) return group.request.short_id;
    if (group.experiment) return group.experiment.short_id;
    return group.key.replace(/^request:/, '').slice(0, 8);
  }

  function navQueueRow(group) {
    var el = document.createElement(group.href ? 'a' : 'div');
    el.className = 'nav-queue-row';
    if (group.href) el.setAttribute('href', group.href);

    var thumb = document.createElement('span');
    thumb.className = 'nav-queue-row-thumb';
    if (group.request && group.request.thumbnail_generation_short_id) {
      var img = document.createElement('img');
      img.src = '/g/' + encodeURIComponent(group.request.thumbnail_generation_short_id) + '/preview';
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
      track('queue.group.click', { kinds: group.kinds, has_request: Boolean(group.request) });
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
  // .load-more link, or nothing). Only galleries without a timeline (ids=) page this way; the
  // timeline gallery lays out skeleton frames for every slot instead (initGalleryTimeline).
  var galleryLoadMoreInFlight = false;
  var galleryScrollObserver = null;

  function galleryPartialUrl(href) {
    const url = new URL(href, location.href);
    url.searchParams.set('partial', '1');
    return url.toString();
  }

  // history.state keeps what Back needs: galleryUntil is the cursor of the last loaded card
  // ('end' once the list is exhausted, accepted by the server as ?until=) for the ids= gallery;
  // the timeline gallery records the anchor card's slot / index / on-screen position.
  function setGalleryState(patch) {
    try {
      history.replaceState(Object.assign({}, history.state, patch), '');
    } catch (e) {}
  }

  function galleryCursorOf(link) {
    return link ? new URL(link.getAttribute('href'), location.href).searchParams.get('cursor') : null;
  }

  function recordGalleryUntil(grid) {
    const cursor = galleryCursorOf(qs('.load-more', grid));
    setGalleryState({ galleryUntil: cursor || 'end' });
  }

  function galleryIndexInSlot(card) {
    const slot = card.getAttribute('data-slot');
    let k = 0;
    for (let p = card.previousElementSibling; p; p = p.previousElementSibling) {
      const ps = p.getAttribute('data-slot');
      if (ps === null) continue;
      if (ps !== slot) break;
      k++;
    }
    return k;
  }

  function recordGalleryAnchor(card) {
    if (!card) return;
    const thumb = qs('.thumb-link', card);
    setGalleryState({
      galleryAnchor: thumb ? thumb.getAttribute('data-short-id') : null,
      galleryAnchorSlot: card.getAttribute('data-slot'),
      galleryAnchorIndex: galleryIndexInSlot(card),
      galleryAnchorTop: card.getBoundingClientRect().top,
      galleryScrollY: window.scrollY,
    });
  }

  // Cards are in document order, so the first one whose bottom is below the viewport top is found by bisection.
  function topVisibleGalleryCard(grid) {
    const cards = qsa('.card', grid);
    let lo = 0;
    let hi = cards.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cards[mid].getBoundingClientRect().bottom > 0) hi = mid;
      else lo = mid + 1;
    }
    return cards[lo];
  }

  function appendGalleryFragment(grid, link, html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const nextLoadMore = wrapper.querySelector('.load-more');
    qsa('.card, .gallery-date-header, .gallery-slot-header, .load-more', wrapper).forEach(function (node) {
      if (node !== nextLoadMore) grid.insertBefore(node, link);
    });
    link.remove();
    if (nextLoadMore) grid.appendChild(nextLoadMore);
    reflowGalleryHeaders(grid);
    fillGalleryCounts(grid);
    return nextLoadMore;
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
      const nextLoadMore = appendGalleryFragment(grid, link, await res.text());
      if (nextLoadMore && galleryScrollObserver) galleryScrollObserver.observe(nextLoadMore);
      recordGalleryUntil(grid);
      return true;
    } catch (e) {
      trackError('gallery.load_more', e, {});
      return false;
    } finally {
      galleryLoadMoreInFlight = false;
    }
  }

  // Back from a detail page re-renders only the first page, so the cards loaded by infinite scroll
  // are fetched again (?until=) and the clicked card is put back where it was on screen.
  async function restoreGalleryCards(grid, olderLink, state) {
    galleryLoadMoreInFlight = true;
    grid.style.visibility = 'hidden';
    try {
      const url = new URL(galleryPartialUrl(olderLink.getAttribute('href')));
      url.searchParams.set('until', state.galleryUntil);
      const res = await fetch(url.toString());
      if (res.ok) {
        appendGalleryFragment(grid, olderLink, await res.text());
        recordGalleryUntil(grid);
      }
      const anchor = qsa('.thumb-link', grid).find(function (a) {
        return a.getAttribute('data-short-id') === state.galleryAnchor;
      });
      if (anchor && typeof state.galleryAnchorTop === 'number') {
        const card = anchor.closest('.card') || anchor;
        window.scrollBy(0, card.getBoundingClientRect().top - state.galleryAnchorTop);
      } else if (typeof state.galleryScrollY === 'number') {
        window.scrollTo(0, state.galleryScrollY);
      }
      return true;
    } catch (e) {
      trackError('gallery.restore', e, {});
      return false;
    } finally {
      grid.style.visibility = '';
      galleryLoadMoreInFlight = false;
    }
  }

  function isBackForwardNavigation() {
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    return !!nav && nav.type === 'back_forward';
  }

  function initGalleryInfiniteScroll() {
    const grid = document.querySelector('[data-gallery-grid]');
    if (!grid || !window.IntersectionObserver || galleryInlineTimeline()) return;
    galleryScrollObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) loadMoreGalleryCards(entry.target);
      });
    });

    grid.addEventListener('click', function (ev) {
      const thumb = ev.target.closest ? ev.target.closest('.thumb-link') : null;
      if (thumb) recordGalleryAnchor(thumb.closest('.card'));
    });
    window.addEventListener('pagehide', function () {
      recordGalleryAnchor(topVisibleGalleryCard(grid));
    });

    const initial = qs('.load-more', grid);
    const state = history.state || {};
    const restoring = !!(isBackForwardNavigation() && initial && state.galleryUntil);
    if (!restoring && state.galleryUntil) setGalleryState({ galleryUntil: null });
    if (restoring) history.scrollRestoration = 'manual';
    const done = restoring ? restoreGalleryCards(grid, initial, state) : Promise.resolve(false);
    done.then(function () {
      const link = qs('.load-more', grid);
      if (link) galleryScrollObserver.observe(link);
    });
  }

  // ---- Gallery timeline: 15-minute JST slot headers + the right-edge rail (docs/ui.md「Gallery」) ----
  var GALLERY_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var galleryTimeline = { ready: false, slots: [], counts: {}, index: {}, days: {}, dayOrder: [], starts: [], total: 0, fraction: 0, dragging: false, dragFraction: 0, refreshTimer: null, frame: 0 };

  function galleryPad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function galleryDateLabel(dateKey) {
    const p = dateKey.split('-');
    const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return Number(p[1]) + '月' + Number(p[2]) + '日（' + GALLERY_WEEKDAYS[d.getUTCDay()] + '）';
  }

  function gallerySlotRange(slot) {
    let hh = Number(slot.slice(11, 13));
    let mm = Number(slot.slice(14, 16)) + 15;
    if (mm === 60) {
      hh = (hh + 1) % 24;
      mm = 0;
    }
    return slot.slice(11, 16) + '–' + galleryPad2(hh) + ':' + galleryPad2(mm);
  }

  function galleryMakeDateHeader(date) {
    const el = document.createElement('div');
    el.className = 'gallery-date-header';
    el.setAttribute('data-date-header', date);
    el.appendChild(document.createTextNode(galleryDateLabel(date)));
    const small = document.createElement('small');
    small.setAttribute('data-count-date', date);
    el.appendChild(small);
    return el;
  }

  function galleryMakeSlotHeader(slot) {
    const el = document.createElement('div');
    el.className = 'gallery-slot-header';
    el.setAttribute('data-slot-header', slot);
    const b = document.createElement('b');
    b.textContent = gallerySlotRange(slot);
    const span = document.createElement('span');
    span.setAttribute('data-count-slot', slot);
    el.appendChild(b);
    el.appendChild(span);
    return el;
  }

  // Headers must precede exactly the first card of each date / slot run. Fragments, live insertion
  // and card removal leave duplicates or orphans at the seams, so the grid is normalized here.
  function reflowGalleryHeaders(grid) {
    const headers = qsa('.gallery-date-header, .gallery-slot-header', grid);
    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i];
      const next = h.nextElementSibling;
      const slot = h.getAttribute('data-slot-header');
      let orphan;
      if (slot) {
        orphan = !next || next.getAttribute('data-slot') !== slot;
      } else {
        const date = h.getAttribute('data-date-header');
        const nextDate = next ? (next.getAttribute('data-slot') || next.getAttribute('data-slot-header') || '').slice(0, 10) : '';
        orphan = nextDate !== date;
      }
      if (orphan) h.remove();
    }
    let lastSlot = null;
    let lastDate = null;
    Array.prototype.slice.call(grid.children).forEach(function (node) {
      const dateHeader = node.getAttribute('data-date-header');
      const slotHeader = node.getAttribute('data-slot-header');
      if (dateHeader) {
        if (dateHeader === lastDate) node.remove();
        else lastDate = dateHeader;
        return;
      }
      if (slotHeader) {
        if (slotHeader === lastSlot) node.remove();
        else lastSlot = slotHeader;
        return;
      }
      const slot = node.getAttribute('data-slot');
      if (!slot || slot === lastSlot) return;
      const date = slot.slice(0, 10);
      if (date !== lastDate) {
        grid.insertBefore(galleryMakeDateHeader(date), node);
        lastDate = date;
      }
      grid.insertBefore(galleryMakeSlotHeader(slot), node);
      lastSlot = slot;
    });
    galleryFill.headers = null;
  }

  function fillGalleryCounts(root) {
    const tl = galleryTimeline;
    if (!tl.ready) return;
    qsa('[data-count-slot]', root).forEach(function (el) {
      const n = tl.counts[el.getAttribute('data-count-slot')];
      el.textContent = n ? ' · ' + n + ' 枚' : '';
    });
    qsa('[data-count-date]', root).forEach(function (el) {
      const day = tl.days[el.getAttribute('data-count-date')];
      el.textContent = day ? day.count.toLocaleString() + ' 枚 · ' + day.slots + ' 枠' : '';
    });
  }

  function buildGalleryTimeline(slots) {
    const tl = galleryTimeline;
    tl.slots = slots;
    tl.counts = {};
    tl.index = {};
    tl.days = {};
    tl.dayOrder = [];
    tl.starts = [];
    tl.total = 0;
    slots.forEach(function (s, i) {
      tl.counts[s.slot] = s.count;
      tl.index[s.slot] = i;
      tl.starts.push(tl.total);
      tl.total += s.count;
      const date = s.slot.slice(0, 10);
      if (!tl.days[date]) {
        tl.days[date] = { count: 0, slots: 0, first: i };
        tl.dayOrder.push(date);
      }
      tl.days[date].count += s.count;
      tl.days[date].slots += 1;
    });
    tl.ready = slots.length > 0 && tl.total > 0;
  }

  function galleryRailSlotAt(f) {
    const tl = galleryTimeline;
    const target = f * tl.total;
    let lo = 0;
    let hi = tl.slots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tl.starts[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function galleryRailEls() {
    const rail = document.getElementById('gallery-rail');
    if (!rail) return null;
    return { rail: rail, track: qs('.gallery-rail-track', rail), thumb: qs('.gallery-rail-thumb', rail), bubble: qs('.gallery-rail-bubble', rail) };
  }

  function showGalleryBubble(f) {
    const els = galleryRailEls();
    const tl = galleryTimeline;
    if (!els || !tl.ready) return;
    const s = tl.slots[galleryRailSlotAt(f)];
    els.bubble.style.top = f * 100 + '%';
    qs('b', els.bubble).textContent = galleryDateLabel(s.slot.slice(0, 10)) + ' ' + gallerySlotRange(s.slot);
    qs('span', els.bubble).textContent = s.count + ' 枚';
  }

  function layoutGalleryRailLabels() {
    const els = galleryRailEls();
    if (!els) return;
    const h = els.track.clientHeight;
    let lastTop = -100;
    qsa('.gallery-rail-label', els.track).forEach(function (label) {
      const top = parseFloat(label.style.top) / 100 * h;
      const hide = top - lastTop < 14;
      label.style.display = hide ? 'none' : '';
      if (!hide) lastTop = top;
    });
  }

  function galleryRailFraction(ev, track) {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
  }

  function galleryStickyOffset(grid) {
    const toolbar = qs('.gallery-toolbar');
    const nav = qs('.nav');
    const top = toolbar ? toolbar.getBoundingClientRect().bottom : nav ? nav.getBoundingClientRect().bottom : 0;
    const dateHeader = qs('.gallery-date-header', grid);
    return top + (dateHeader ? dateHeader.offsetHeight : 0);
  }

  // Scrolls to the fraction f of the rail. Every slot has its frames laid out already, so the
  // target is always in the DOM; the cards there fill in as they come near the viewport.
  function jumpGalleryTimeline(f) {
    const grid = galleryGrid();
    const tl = galleryTimeline;
    if (!grid || !tl.ready) return false;
    const idx = galleryRailSlotAt(f);
    const s = tl.slots[idx];
    const header = grid.querySelector('[data-slot-header="' + s.slot + '"]');
    if (!header) return false;
    const cards = qsa('.card[data-slot="' + s.slot + '"]', grid);
    const within = Math.min(Math.max(f * tl.total - tl.starts[idx], 0), s.count);
    const k = Math.floor(within);
    const target = k > 0 && cards.length > 0 ? cards[Math.min(k, cards.length - 1)] : header;
    const gap = target === header ? 4 : 0;
    window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - galleryStickyOffset(grid) - gap);
    return true;
  }

  // The topmost visible card gives the slot and the position inside it.
  function syncGalleryThumb() {
    const tl = galleryTimeline;
    const els = galleryRailEls();
    const grid = galleryGrid();
    if (!els || !grid || !tl.ready || tl.dragging) return;
    const cards = qsa('.card[data-slot]', grid);
    if (cards.length === 0) return;
    const offset = galleryStickyOffset(grid);
    let lo = 0;
    let hi = cards.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cards[mid].getBoundingClientRect().bottom > offset) hi = mid;
      else lo = mid + 1;
    }
    const card = cards[lo];
    const slot = card.getAttribute('data-slot');
    const idx = tl.index[slot];
    if (idx === undefined) return;
    const k = galleryIndexInSlot(card);
    const r = card.getBoundingClientRect();
    const cardFrac = r.height > 0 ? Math.min(1, Math.max(0, (offset - r.top) / r.height)) : 0;
    const f = Math.min(1, (tl.starts[idx] + Math.min(k + cardFrac, tl.slots[idx].count)) / tl.total);
    tl.fraction = f;
    els.thumb.style.top = f * 100 + '%';
    els.rail.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    els.rail.setAttribute('aria-valuetext', galleryDateLabel(slot.slice(0, 10)) + ' ' + gallerySlotRange(slot));
    showGalleryBubble(f);
  }

  function scheduleGalleryThumbSync() {
    const tl = galleryTimeline;
    if (tl.frame) return;
    tl.frame = requestAnimationFrame(function () {
      tl.frame = 0;
      syncGalleryThumb();
    });
  }

  function createGalleryRail() {
    const rail = document.createElement('div');
    rail.id = 'gallery-rail';
    rail.className = 'gallery-rail';
    rail.tabIndex = 0;
    rail.setAttribute('role', 'slider');
    rail.setAttribute('aria-label', '日時へ移動');
    rail.setAttribute('aria-valuemin', '0');
    rail.setAttribute('aria-valuemax', '100');
    rail.innerHTML =
      '<div class="gallery-rail-track"><div class="gallery-rail-line"></div><div class="gallery-rail-thumb"></div>' +
      '<div class="gallery-rail-bubble"><b></b><span></span></div></div>';
    const track = qs('.gallery-rail-track', rail);
    const tl = galleryTimeline;
    const finish = function () {
      tl.dragging = false;
      rail.classList.remove('dragging');
    };
    rail.addEventListener('pointerdown', function (ev) {
      tl.dragging = true;
      rail.classList.add('dragging');
      rail.setPointerCapture(ev.pointerId);
      const f = galleryRailFraction(ev, track);
      tl.dragFraction = f;
      showGalleryBubble(f);
      qs('.gallery-rail-thumb', rail).style.top = f * 100 + '%';
      jumpGalleryTimeline(f);
    });
    rail.addEventListener('pointermove', function (ev) {
      const f = galleryRailFraction(ev, track);
      showGalleryBubble(f);
      if (tl.dragging) {
        tl.dragFraction = f;
        qs('.gallery-rail-thumb', rail).style.top = f * 100 + '%';
        jumpGalleryTimeline(f);
      }
    });
    rail.addEventListener('pointerup', function (ev) {
      if (!tl.dragging) return;
      const f = galleryRailFraction(ev, track);
      finish();
      jumpGalleryTimeline(f);
      syncGalleryThumb();
    });
    rail.addEventListener('pointercancel', finish);
    rail.addEventListener('mouseleave', syncGalleryThumb);
    rail.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'PageDown') {
        jumpGalleryTimeline(Math.min(1, tl.fraction + 0.02));
        ev.preventDefault();
      } else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') {
        jumpGalleryTimeline(Math.max(0, tl.fraction - 0.02));
        ev.preventDefault();
      }
    });
    document.body.appendChild(rail);
    return rail;
  }

  function renderGalleryRail() {
    const tl = galleryTimeline;
    let rail = document.getElementById('gallery-rail');
    if (!tl.ready) {
      if (rail) rail.hidden = true;
      return;
    }
    if (!rail) rail = createGalleryRail();
    rail.hidden = false;
    const track = qs('.gallery-rail-track', rail);
    qsa('.gallery-rail-label, .gallery-rail-dot', track).forEach(function (el) {
      el.remove();
    });
    tl.dayOrder.forEach(function (date) {
      const label = document.createElement('div');
      label.className = 'gallery-rail-label';
      label.style.top = (tl.starts[tl.days[date].first] / tl.total) * 100 + '%';
      label.textContent = Number(date.slice(5, 7)) + '/' + Number(date.slice(8));
      track.appendChild(label);
    });
    tl.slots.forEach(function (s, i) {
      if (s.count < 20) return;
      const dot = document.createElement('div');
      dot.className = 'gallery-rail-dot';
      dot.style.top = ((tl.starts[i] + s.count / 2) / tl.total) * 100 + '%';
      track.appendChild(dot);
    });
    layoutGalleryRailLabels();
    syncGalleryThumb();
  }

  // ---- Gallery skeleton layout: every slot's frames exist up front (docs/ui.md「Gallery timeline」) ----
  // The inline timeline (#gallery-timeline-data) names every slot and its count, so the whole list is
  // laid out with fixed-size frames at once; real cards replace them one-for-one as they near the viewport.
  var galleryFill = { inFlight: 0, busy: {}, retryAt: {}, headers: null, frame: 0, timer: 0 };
  var GALLERY_FILL_MAX_IN_FLIGHT = 3;
  var GALLERY_FILL_MAX_CARDS = 200;

  // Returns the slots only when there is something to lay out; null selects the old paging behaviour.
  function galleryInlineTimeline() {
    const el = document.getElementById('gallery-timeline-data');
    if (!el) return null;
    try {
      const data = JSON.parse(el.textContent);
      if (!data || !Array.isArray(data.slots) || data.slots.length === 0) return null;
      return data.slots;
    } catch (e) {
      return null;
    }
  }

  function galleryDateHeaderHtml(date) {
    return '<div class="gallery-date-header" data-date-header="' + date + '">' + galleryDateLabel(date) + '<small data-count-date="' + date + '"></small></div>';
  }

  function gallerySlotHeaderHtml(slot) {
    return '<div class="gallery-slot-header" data-slot-header="' + slot + '"><b>' + gallerySlotRange(slot) + '</b><span data-count-slot="' + slot + '"></span></div>';
  }

  function gallerySkeletonHtml(slot, n) {
    return n > 0 ? ('<div class="card card-skeleton" data-slot="' + slot + '"></div>').repeat(n) : '';
  }

  // Headers + frames for slots[from, to). A date header is added whenever the date differs from prevDate.
  function galleryRunHtml(slots, from, to, prevDate) {
    const parts = [];
    let date = prevDate;
    for (let i = from; i < to; i++) {
      const s = slots[i];
      const d = s.slot.slice(0, 10);
      if (d !== date) {
        parts.push(galleryDateHeaderHtml(d));
        date = d;
      }
      parts.push(gallerySlotHeaderHtml(s.slot), gallerySkeletonHtml(s.slot, s.count));
    }
    return parts.join('');
  }

  // The server rendered the first page (the page starting at the at= slot in at mode). Frames for
  // the rest of that page's last slot and every older slot go after it, frames for newer slots
  // (at mode) go before it, and the viewport stays on the first real card.
  function galleryBuildSkeletons(grid, keepViewport) {
    const tl = galleryTimeline;
    qsa('.load-more, .load-newer', grid).forEach(function (el) {
      el.remove();
    });
    const cards = qsa('.card[data-slot]', grid);
    if (cards.length === 0) return;
    const first = cards[0];
    const firstIdx = tl.index[first.getAttribute('data-slot')];
    const lastSlot = cards[cards.length - 1].getAttribute('data-slot');
    const lastIdx = tl.index[lastSlot];
    if (firstIdx === undefined || lastIdx === undefined) return;
    let lastSlotCards = 0;
    for (let i = cards.length - 1; i >= 0 && cards[i].getAttribute('data-slot') === lastSlot; i--) lastSlotCards++;

    const before = first.getBoundingClientRect().top;
    const older = gallerySkeletonHtml(lastSlot, tl.counts[lastSlot] - lastSlotCards) + galleryRunHtml(tl.slots, lastIdx + 1, tl.slots.length, lastSlot.slice(0, 10));
    grid.insertAdjacentHTML('beforeend', older);
    if (firstIdx > 0) grid.insertAdjacentHTML('afterbegin', galleryRunHtml(tl.slots, 0, firstIdx, null));
    reflowGalleryHeaders(grid);
    if (keepViewport && firstIdx > 0) window.scrollBy(0, first.getBoundingClientRect().top - before);
  }

  function galleryHeaderList(grid) {
    if (!galleryFill.headers) galleryFill.headers = qsa('.gallery-slot-header', grid);
    return galleryFill.headers;
  }

  // Frames always trail the real cards of a slot, so the last element of the run says whether any are left.
  function galleryRunHasFrames(grid, headers, i) {
    let end = i + 1 < headers.length ? headers[i + 1].previousElementSibling : grid.lastElementChild;
    while (end && end.classList.contains('gallery-date-header')) end = end.previousElementSibling;
    return !!end && end.classList.contains('card-skeleton');
  }

  // The next group of adjacent slots to fetch: slots with frames still pending inside 1.5 viewports
  // of the screen, split into runs of adjacent slots of at most 200 cards, nearest to the screen centre first.
  function galleryNextFillBatch(grid) {
    const tl = galleryTimeline;
    const headers = galleryHeaderList(grid);
    if (headers.length === 0) return null;
    const vh = window.innerHeight;
    const lo = -vh * 1.5;
    const hi = vh * 2.5;
    const center = vh / 2;
    let a = 0;
    let b = headers.length - 1;
    while (a < b) {
      const mid = (a + b + 1) >> 1;
      if (headers[mid].getBoundingClientRect().top <= lo) a = mid;
      else b = mid - 1;
    }
    const now = Date.now();
    const batches = [];
    let cur = null;
    for (let i = a; i < headers.length; i++) {
      const top = headers[i].getBoundingClientRect().top;
      if (top > hi) break;
      const slot = headers[i].getAttribute('data-slot-header');
      const pending = galleryRunHasFrames(grid, headers, i) && !galleryFill.busy[slot] && !(galleryFill.retryAt[slot] > now);
      if (!pending) {
        cur = null;
        continue;
      }
      const bottom = i + 1 < headers.length ? headers[i + 1].getBoundingClientRect().top : Infinity;
      const dist = center < top ? top - center : center > bottom ? center - bottom : 0;
      const count = tl.counts[slot] || 1;
      const idx = tl.index[slot];
      if (cur && cur.lastIdx + 1 === idx && cur.cards + count <= GALLERY_FILL_MAX_CARDS) {
        cur.slots.push(slot);
        cur.cards += count;
        cur.lastIdx = idx;
        cur.dist = Math.min(cur.dist, dist);
      } else {
        cur = { slots: [slot], cards: count, lastIdx: idx, dist: dist };
        batches.push(cur);
      }
    }
    let best = null;
    batches.forEach(function (x) {
      if (!best || x.dist < best.dist) best = x;
    });
    return best ? best.slots : null;
  }

  // Replaces the frames of one slot with the fetched cards. Cards already in the slot's run (live
  // arrivals, the rest of the first page) are kept and not duplicated. Returns true when the slot's
  // real count turned out different from the timeline's.
  function galleryReplaceSlot(grid, slot, cards) {
    const header = grid.querySelector('[data-slot-header="' + slot + '"]');
    if (!header) return false;
    const have = {};
    const frames = [];
    let real = 0;
    for (let el = header.nextElementSibling; el && el.getAttribute('data-slot') === slot; el = el.nextElementSibling) {
      if (el.classList.contains('card-skeleton')) {
        frames.push(el);
      } else {
        real++;
        const a = qs('.thumb-link', el);
        if (a) have[a.getAttribute('data-short-id')] = true;
      }
    }
    if (frames.length === 0) return false;
    const fresh = cards.filter(function (card) {
      const a = qs('.thumb-link', card);
      return !(a && have[a.getAttribute('data-short-id')]);
    });
    const frag = document.createDocumentFragment();
    fresh.forEach(function (card) {
      frag.appendChild(card);
      qsa('[data-request-id]', card).forEach(registerRequestElement);
    });
    grid.insertBefore(frag, frames[0]);
    frames.forEach(function (el) {
      el.remove();
    });
    return real + fresh.length !== galleryTimeline.counts[slot];
  }

  async function galleryFillSlots(grid, slots) {
    const fill = galleryFill;
    slots.forEach(function (s) {
      fill.busy[s] = true;
    });
    fill.inFlight++;
    try {
      const url = new URL(location.href);
      ['cursor', 'until', 'partial', 'after', 'at', 'limit', 'slot_from', 'slot_to'].forEach(function (k) {
        url.searchParams.delete(k);
      });
      url.searchParams.set('slot_from', slots[slots.length - 1]);
      url.searchParams.set('slot_to', slots[0]);
      url.searchParams.set('partial', '1');
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('status ' + res.status);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = await res.text();
      const bySlot = {};
      qsa('.card[data-slot]', wrapper).forEach(function (card) {
        const slot = card.getAttribute('data-slot');
        (bySlot[slot] = bySlot[slot] || []).push(card);
      });
      const tl = galleryTimeline;
      let mismatch = false;
      slots.forEach(function (slot) {
        if (galleryReplaceSlot(grid, slot, bySlot[slot] || [])) {
          mismatch = true;
          const run = qsa('.card[data-slot="' + slot + '"]', grid).length;
          tl.slots = tl.slots
            .map(function (s) {
              return s.slot === slot ? { slot: slot, count: run } : s;
            })
            .filter(function (s) {
              return s.count > 0;
            });
        }
      });
      if (mismatch) {
        buildGalleryTimeline(tl.slots);
        reflowGalleryHeaders(grid);
        fillGalleryCounts(grid);
        renderGalleryRail();
      }
    } catch (e) {
      trackError('gallery.fill', e, { slots: slots.length });
      slots.forEach(function (s) {
        fill.retryAt[s] = Date.now() + 5000;
      });
      clearTimeout(fill.timer);
      fill.timer = setTimeout(pumpGalleryFill, 5000);
    } finally {
      slots.forEach(function (s) {
        delete fill.busy[s];
      });
      fill.inFlight--;
      pumpGalleryFill();
    }
  }

  function pumpGalleryFill() {
    const grid = galleryGrid();
    if (!grid || !galleryTimeline.ready || !galleryInlineTimelineActive) return;
    while (galleryFill.inFlight < GALLERY_FILL_MAX_IN_FLIGHT) {
      const batch = galleryNextFillBatch(grid);
      if (!batch) return;
      galleryFillSlots(grid, batch);
    }
  }

  function scheduleGalleryFill() {
    if (galleryFill.frame) return;
    galleryFill.frame = requestAnimationFrame(function () {
      galleryFill.frame = 0;
      pumpGalleryFill();
    });
  }

  // Back: put the anchor card (by short_id when it is still there, else by slot + index) back at its recorded screen position.
  function restoreGalleryAnchor(grid, state) {
    let card = null;
    if (state.galleryAnchor) {
      const a = qsa('.thumb-link', grid).find(function (x) {
        return x.getAttribute('data-short-id') === state.galleryAnchor;
      });
      card = a ? a.closest('.card') : null;
    }
    if (!card && state.galleryAnchorSlot) {
      const cards = qsa('.card[data-slot="' + state.galleryAnchorSlot + '"]', grid);
      card = cards[Math.min(state.galleryAnchorIndex || 0, cards.length - 1)] || null;
    }
    if (card && typeof state.galleryAnchorTop === 'number') {
      window.scrollBy(0, card.getBoundingClientRect().top - state.galleryAnchorTop);
    } else if (typeof state.galleryScrollY === 'number') {
      window.scrollTo(0, state.galleryScrollY);
    }
  }

  var galleryInlineTimelineActive = false;

  function setupGallerySkeleton(grid, slots) {
    buildGalleryTimeline(slots);
    if (!galleryTimeline.ready) return;
    galleryInlineTimelineActive = true;
    const state = history.state || {};
    const restoring = isBackForwardNavigation() && !!state.galleryAnchorSlot;
    galleryBuildSkeletons(grid, !restoring);
    if (restoring) {
      history.scrollRestoration = 'manual';
      restoreGalleryAnchor(grid, state);
    }
    grid.addEventListener('click', function (ev) {
      const thumb = ev.target.closest ? ev.target.closest('.thumb-link') : null;
      if (thumb) recordGalleryAnchor(thumb.closest('.card'));
    });
    window.addEventListener('pagehide', function () {
      recordGalleryAnchor(topVisibleGalleryCard(grid));
    });
    window.addEventListener('scroll', scheduleGalleryFill, { passive: true });
    window.addEventListener('resize', scheduleGalleryFill);
    fillGalleryCounts(grid);
    renderGalleryRail();
    pumpGalleryFill();
  }

  async function fetchGalleryTimeline() {
    const grid = galleryGrid();
    const query = grid ? grid.getAttribute('data-timeline-query') : null;
    if (!grid || query === null) return;
    try {
      const res = await fetch('/api/v1/generations/timeline' + (query ? '?' + query : ''));
      if (!res.ok) return;
      const data = await res.json();
      buildGalleryTimeline(Array.isArray(data.slots) ? data.slots : []);
      fillGalleryCounts(grid);
      renderGalleryRail();
    } catch (e) {
      trackError('gallery.timeline', e, {});
    }
  }

  function scheduleGalleryTimelineRefresh() {
    const tl = galleryTimeline;
    if (!galleryGrid() || galleryGrid().getAttribute('data-timeline-query') === null) return;
    clearTimeout(tl.refreshTimer);
    tl.refreshTimer = setTimeout(fetchGalleryTimeline, 800);
  }

  function updateGalleryStickyTop() {
    const grid = galleryGrid();
    const toolbar = qs('.gallery-toolbar');
    const nav = qs('.nav');
    if (!grid || !toolbar || !nav) return;
    grid.style.setProperty('--gallery-sticky-top', nav.offsetHeight + toolbar.offsetHeight + 'px');
  }

  function initGalleryTimeline() {
    const grid = galleryGrid();
    if (!grid) return;
    updateGalleryStickyTop();
    const toolbar = qs('.gallery-toolbar');
    if (toolbar && window.ResizeObserver) new ResizeObserver(updateGalleryStickyTop).observe(toolbar);
    window.addEventListener('resize', function () {
      updateGalleryStickyTop();
      layoutGalleryRailLabels();
      scheduleGalleryThumbSync();
    });
    window.addEventListener('scroll', scheduleGalleryThumbSync, { passive: true });
    const slots = galleryInlineTimeline();
    if (slots) setupGallerySkeleton(grid, slots);
    else fetchGalleryTimeline();
  }

  // ---- ワークベンチ (/work/:shortId, docs/ui.md「Workbench」) ----
  var WB_PHASES = [
    { no: 1, label: '描き直し' },
    { no: 2, label: '光' },
    { no: 3, label: '部分' },
    { no: 4, label: '納品' },
    { no: 5, label: 'ボケ' },
  ];
  var WB_RATING_COLOR = { bad: 'var(--bad)', neutral: 'var(--neutral)', good: 'var(--good)' };

  function wbEl(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function wbRound(v) {
    return Math.round(v * 10000) / 10000;
  }

  // The visible box of an object-fit: contain image inside its pane: [left, top, width, height] in px.
  function wbContainBox(paneWidth, paneHeight, imageWidth, imageHeight) {
    var scale = Math.min(paneWidth / imageWidth, paneHeight / imageHeight);
    var w = imageWidth * scale;
    var h = imageHeight * scale;
    return [(paneWidth - w) / 2, (paneHeight - h) / 2, w, h];
  }

  var WB_LOUPE_ZOOMS = [2, 3, 5, 8];
  var WB_LOUPE_OFFSET = 24;

  // Loupe geometry in px relative to the overlay box.
  function wbLoupeLayout(cursor, box, zoom, side) {
    var size = Math.min(side, Math.min(box.width, box.height) * 0.5);
    var bgW = box.width * zoom;
    var bgH = box.height * zoom;
    var flipX = cursor.x > 0.7;
    var flipY = cursor.y < 0.3;
    var px = cursor.x * box.width;
    var py = cursor.y * box.height;
    var left = flipX ? px - WB_LOUPE_OFFSET - size : px + WB_LOUPE_OFFSET;
    var top = flipY ? py + WB_LOUPE_OFFSET : py - WB_LOUPE_OFFSET - size;
    return {
      left: Math.min(Math.max(left, 0), box.width - size),
      top: Math.min(Math.max(top, 0), box.height - size),
      size: size,
      bgW: bgW,
      bgH: bgH,
      bgX: size / 2 - cursor.x * bgW,
      bgY: size / 2 - cursor.y * bgH,
      flipX: flipX,
      flipY: flipY
    };
  }

  function wbRectsOverlap(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  }

  // Same text as formatImageMetaText in src/lib/image-meta.ts; '' while the size is unknown.
  function imageMetaText(node) {
    if (!node || node.image_size === null || node.image_size === undefined) return '';
    var size = node.image_size;
    var text;
    if (size < 1024) {
      text = size + ' B';
    } else {
      var units = ['KB', 'MB', 'GB'];
      var value = size / 1024;
      var unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      text = value.toFixed(1) + ' ' + units[unit];
    }
    return node.image_width && node.image_height ? node.image_width + '×' + node.image_height + ' · ' + text : text;
  }

  function captionWithMeta(label, node) {
    var meta = imageMetaText(node);
    return meta ? label + ' · ' + meta : label;
  }

  // Fills (or hides, for a null node) the CapActions box (src/ui/components/CapActions.tsx) of one pane.
  function wbRenderCapActions(root, side, node) {
    var box = qs('[data-wb-cap-actions="' + side + '"]', root);
    box.hidden = !node;
    if (!node) return box.removeAttribute('data-wb-cap-for');
    box.setAttribute('data-wb-cap-for', node.id);
    var id = qs('[data-wb-cap-id]', box);
    id.textContent = node.short_id;
    id.setAttribute('data-copy-id', node.short_id);
    qs('[data-wb-cap-link]', box).setAttribute('href', '/g/' + node.short_id);
    var work = qs('[data-wb-cap-work]', box);
    if (work) work.setAttribute('href', '/work/' + node.short_id);
    qs('.rating-group', box).setAttribute('data-generation-id', node.id);
    applyRatingToGroups(node.id, node.rating);
    var bookmark = qs('[data-wb-bookmark]', box);
    bookmark.setAttribute('data-id', node.id);
    bookmark.setAttribute('data-bookmarked', node.bookmark ? 'true' : 'false');
  }

  // The image panes, crosshair and loupe the workbench, the style check and the reroll screen share. wb is the caller's state: it supplies
  // cursor ({x, y} on the image, or null) and loupe ({on, zoom}), which the viewer reads and the caller may also set.
  function wbViewer(root, wb) {
    var resizeObserver = window.ResizeObserver ? new ResizeObserver(function (entries) {
      entries.forEach(function (entry) { layoutPane(entry.target); });
    }) : null;

    function layoutPane(pane) {
      var img = qs('img', pane);
      var overlay = qs('.wb-overlay', pane);
      if (!img || !overlay || !img.naturalWidth || !pane.clientWidth) return;
      var box = wbContainBox(pane.clientWidth, pane.clientHeight, img.naturalWidth, img.naturalHeight);
      overlay.style.left = box[0] + 'px';
      overlay.style.top = box[1] + 'px';
      overlay.style.width = box[2] + 'px';
      overlay.style.height = box[3] + 'px';
      overlay.hidden = false;
      scheduleLoupes();
    }

    // Fills a pane with the image of a Generation (or a placeholder for a pending one). role: 'input' | 'cmp'.
    function fillPane(pane, key, role, node, pendingItem) {
      var signature = role + ':' + key;
      if (pane.getAttribute('data-wb-key') !== signature) {
        pane.setAttribute('data-wb-key', signature);
        pane.setAttribute('data-wb-role', role);
        pane.setAttribute('data-wb-imgpane', '');
        pane.textContent = '';
        pane.classList.toggle('wb-checker', !!(node && node.delivered));
        if (node) {
          var img = document.createElement('img');
          img.alt = node.short_id;
          img.draggable = false;
          img.addEventListener('load', function () { layoutPane(pane); });
          img.addEventListener('error', function () {
            if (img.getAttribute('src') !== '/g/' + node.short_id + '/preview') img.src = '/g/' + node.short_id + '/preview';
          });
          img.src = '/g/' + node.short_id + '/image';
          pane.appendChild(img);
          var overlay = wbEl('div', 'wb-overlay');
          overlay.hidden = true;
          overlay.appendChild(wbEl('div', 'wb-cross-x'));
          overlay.appendChild(wbEl('div', 'wb-cross-y'));
          var loupe = wbEl('div', 'wb-loupe');
          loupe.hidden = true;
          loupe.appendChild(wbEl('div', 'wb-loupe-cross'));
          overlay.appendChild(loupe);
          overlay.appendChild(wbEl('div', 'wb-rects'));
          var guideClip = wbEl('div', 'dof-guide-clip');
          guideClip.appendChild(wbEl('div', 'dof-guide-circle wb-guide'));
          overlay.appendChild(guideClip);
          overlay.appendChild(wbEl('div', 'dof-focus-marker wb-focus'));
          pane.appendChild(overlay);
          if (resizeObserver) resizeObserver.observe(pane);
        } else if (pendingItem) {
          pane.appendChild(wbEl('div', 'wb-pending-note', '処理中…'));
        }
      }
      if (pendingItem) {
        var note = qs('.wb-pending-note', pane);
        if (note) note.textContent = (pendingItem.status === 'queued' ? '待機中…' : '処理中…') + (pendingItem.progress ? ' ' + pendingItem.progress : '');
      }
    }

    function imagePanes() {
      return qsa('[data-wb-imgpane]', root);
    }

    // Coordinates are relative to the rendered image box (the overlay), never the pane.
    function pointIn(pane, ev) {
      var overlay = qs('.wb-overlay', pane);
      if (!overlay || overlay.hidden) return null;
      var r = overlay.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      var x = (ev.clientX - r.left) / r.width;
      var y = (ev.clientY - r.top) / r.height;
      return { x: x, y: y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
    }

    var loupeFrame = 0;

    function scheduleLoupes() {
      if (loupeFrame) return;
      loupeFrame = requestAnimationFrame(function () {
        loupeFrame = 0;
        updateLoupes();
      });
    }

    function updateLoupes() {
      var show = !!(wb.cursor && wb.loupe.on);
      imagePanes().forEach(function (pane) {
        var overlay = qs('.wb-overlay', pane);
        var loupe = overlay && qs('.wb-loupe', overlay);
        var img = qs('img', pane);
        if (!loupe) return;
        var width = overlay.clientWidth;
        var height = overlay.clientHeight;
        loupe.hidden = !(show && !overlay.hidden && img && width > 0 && height > 0);
        if (loupe.hidden) return;
        var l = wbLoupeLayout(wb.cursor, { width: width, height: height }, wb.loupe.zoom, 280);
        var src = (img.currentSrc || img.src).replace(/"/g, '%22');
        var layers = 'url("' + src + '") ' + l.bgX + 'px ' + l.bgY + 'px / ' + l.bgW + 'px ' + l.bgH + 'px no-repeat, ';
        loupe.style.background = layers + (pane.classList.contains('wb-checker') ? 'var(--checker)' : 'var(--bg-elevated)');
        loupe.classList.toggle('wb-loupe-pixel', wb.loupe.zoom >= 5);
        loupe.style.left = l.left + 'px';
        loupe.style.top = l.top + 'px';
        loupe.style.width = l.size + 'px';
        loupe.style.height = l.size + 'px';
      });
    }

    function renderLoupeControls() {
      var toggle = qs('[data-wb-loupe-toggle]', root);
      if (toggle) toggle.classList.toggle('wb-pill-on', wb.loupe.on);
      qsa('[data-wb-loupe-zoom]', root).forEach(function (b) {
        b.classList.toggle('wb-pill-on', Number(b.getAttribute('data-wb-loupe-zoom')) === wb.loupe.zoom);
      });
    }

    function setLoupe(on, zoom) {
      wb.loupe = { on: on, zoom: zoom };
      try { localStorage.setItem('wb.loupe', JSON.stringify(wb.loupe)); } catch (e) { /* localStorage unavailable */ }
      renderLoupeControls();
      scheduleLoupes();
    }

    function stepLoupeZoom(delta) {
      var i = WB_LOUPE_ZOOMS.indexOf(wb.loupe.zoom) + delta;
      if (i < 0 || i >= WB_LOUPE_ZOOMS.length) return;
      setLoupe(wb.loupe.on, WB_LOUPE_ZOOMS[i]);
    }

    try {
      var storedLoupe = JSON.parse(localStorage.getItem('wb.loupe') || 'null');
      if (storedLoupe && WB_LOUPE_ZOOMS.indexOf(storedLoupe.zoom) >= 0) wb.loupe = { on: storedLoupe.on !== false, zoom: storedLoupe.zoom };
    } catch (e) { /* localStorage unavailable */ }
    renderLoupeControls();

    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (ev.key === 'z' || ev.key === 'Z') setLoupe(!wb.loupe.on, wb.loupe.zoom);
      else if (ev.key === '[') stepLoupeZoom(-1);
      else if (ev.key === ']') stepLoupeZoom(1);
    });

    // Crosshair on every image pane; the caller draws anything else (rects, focus) itself.
    function updateCrosshair() {
      imagePanes().forEach(function (pane) {
        var overlay = qs('.wb-overlay', pane);
        if (!overlay) return;
        var cx = qs('.wb-cross-x', overlay);
        var cy = qs('.wb-cross-y', overlay);
        cx.hidden = cy.hidden = !wb.cursor;
        if (wb.cursor) {
          cx.style.left = wb.cursor.x * 100 + '%';
          cy.style.top = wb.cursor.y * 100 + '%';
        }
      });
      scheduleLoupes();
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target : null;
      if (!t) return;
      if (t.closest('[data-wb-loupe-toggle]')) return setLoupe(!wb.loupe.on, wb.loupe.zoom);
      var loupeZoom = t.closest('[data-wb-loupe-zoom]');
      if (loupeZoom) setLoupe(wb.loupe.on, Number(loupeZoom.getAttribute('data-wb-loupe-zoom')));
    });

    // Cursor tracking for callers with nothing to draw on the panes; the workbench tracks it itself while drawing.
    function trackCursor() {
      root.addEventListener('pointermove', function (ev) {
        var pane = ev.target.closest ? ev.target.closest('[data-wb-imgpane]') : null;
        if (!pane) return;
        var p = pointIn(pane, ev);
        wb.cursor = p && p.inside ? { x: p.x, y: p.y } : null;
        updateCrosshair();
      });
      root.addEventListener('pointerleave', function () {
        wb.cursor = null;
        updateCrosshair();
      });
    }

    return { fillPane: fillPane, layoutPane: layoutPane, imagePanes: imagePanes, pointIn: pointIn, scheduleLoupes: scheduleLoupes, updateCrosshair: updateCrosshair, trackCursor: trackCursor };
  }

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function initWorkbench() {
    var root = qs('[data-workbench]');
    if (!root) return;
    var initial = {};
    try { initial = JSON.parse(root.getAttribute('data-initial') || '{}'); } catch (e) { initial = {}; }
    var rootId = root.getAttribute('data-root-id');
    var wb = {
      nodes: (initial.tree && initial.tree.nodes) || [],
      pending: (initial.tree && initial.tree.pending) || [],
      picks: initial.picks || {},
      active: 1,
      compareId: null,
      mode: 'pair',
      cursor: null,
      loupe: { on: true, zoom: 3 },
      forcedInput: null,
      method: 'hires',
      partMode: 'auto',
      rects: [],
      draft: null,
      focus: null,
      error: '',
      timer: null,
    };
    var viewer = wbViewer(root, wb);
    var fillPane = viewer.fillPane;
    var imagePanes = viewer.imagePanes;
    var layoutPane = viewer.layoutPane;
    var pointIn = viewer.pointIn;
    var scheduleLoupes = viewer.scheduleLoupes;

    function nodeById(id) {
      for (var i = 0; i < wb.nodes.length; i++) if (wb.nodes[i].id === id) return wb.nodes[i];
      return null;
    }

    function pendingByRequest(requestId) {
      for (var i = 0; i < wb.pending.length; i++) if (wb.pending[i].request_id === requestId) return wb.pending[i];
      return null;
    }

    function pick(k) {
      return wb.picks[String(k)] || null;
    }

    // The input of phase k is the pick of phase k-1; a skipped phase passes its own input on.
    function inputOf(k) {
      if (k === wb.active && wb.forcedInput) return wb.forcedInput;
      if (k === 1) return rootId;
      var p = pick(k - 1);
      if (!p) return null;
      return p.skip ? inputOf(k - 1) : p.generation_id;
    }

    function reached(k) {
      return k === 1 || !!pick(k - 1) || k === wb.active;
    }

    function candidates(k) {
      var input = inputOf(k);
      if (!input) return [];
      var list = [];
      wb.nodes.forEach(function (n) {
        if (n.phase === k && n.refines_generation_id === input) list.push({ key: n.id, node: n, pending: null });
      });
      wb.pending.forEach(function (p) {
        if (p.phase === k && p.source_generation_id === input) list.push({ key: 'p:' + p.request_id, node: null, pending: p });
      });
      return list;
    }

    function candidateByKey(k, key) {
      var list = candidates(k);
      for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
      return null;
    }

    function defaultCompare(k) {
      var list = candidates(k);
      var p = pick(k);
      if (p && !p.skip) {
        for (var i = 0; i < list.length; i++) if (list[i].key === p.generation_id) return list[i].key;
      }
      return list.length ? list[list.length - 1].key : null;
    }

    function kindLabel(node) {
      return node.kind === 'redraw' && node.method ? 'redraw · ' + node.method : node.kind;
    }

    function pendingKindLabel(p) {
      return p.kind === 'redraw' && p.method ? 'redraw · ' + p.method : p.kind;
    }

    function summarize(kind, method, o) {
      o = o || {};
      if (kind === 'redraw') {
        if (method === 'hires') return 'hires ' + (o.hires || '') + (o.denoise !== undefined ? ' · denoise ' + o.denoise : '');
        if (method === 'light') return 'light · ' + (o.scene || '') + ' · from ' + (o.from || '');
        return 'canvas' + (o.denoise !== undefined ? ' · denoise ' + o.denoise : '') + (o.size ? ' · ' + o.size : '');
      }
      if (kind === 'repair') return o.parts ? o.parts.join('+') : '手と足';
      if (kind === 'masked_redraw') return (o.regions ? o.regions.length : 0) + ' か所 · ' + (o.prompt_patch || '');
      if (kind === 'deliver') {
        var bands = o.outlines ? 'フチ ' + o.outlines.length + ' 本' : 'フチ 既定';
        return (o.backdrop === null ? '透過' : '背景あり') + ' · ' + bands;
      }
      if (kind === 'dof') return 'F' + (o.f_number || '') + (o.focus ? ' · [' + o.focus[0] + ', ' + o.focus[1] + ']' : '');
      return '';
    }

    function itemKind(item) {
      return item.node ? kindLabel(item.node) : pendingKindLabel(item.pending);
    }

    function itemSummary(item) {
      return item.node ? summarize(item.node.kind, item.node.method, item.node.options) : summarize(item.pending.kind, item.pending.method, item.pending.options);
    }

    function itemStatus(item) {
      if (item.pending) return item.pending.status === 'queued' ? '待機中…' : '処理中…';
      return item.node.delivered ? '納品' : '完了';
    }

    function updateOverlays() {
      var rectsActive = wb.active === 3 && wb.partMode === 'rect';
      viewer.updateCrosshair();
      imagePanes().forEach(function (pane) {
        var overlay = qs('.wb-overlay', pane);
        if (!overlay) return;
        var role = pane.getAttribute('data-wb-role');
        var rects = qs('.wb-rects', overlay);
        rects.textContent = '';
        if (role === 'input' && rectsActive) {
          wb.rects.concat(wb.draft ? [wb.draft] : []).forEach(function (r, i) {
            var d = wbEl('div', 'wb-rect' + (i >= wb.rects.length ? ' wb-rect-draft' : ''));
            d.style.left = r[0] * 100 + '%';
            d.style.top = r[1] * 100 + '%';
            d.style.width = (r[2] - r[0]) * 100 + '%';
            d.style.height = (r[3] - r[1]) * 100 + '%';
            rects.appendChild(d);
          });
        }
        var marker = qs('.wb-focus', overlay);
        marker.hidden = !(role === 'input' && wb.active === 5 && wb.focus);
        if (!marker.hidden) {
          marker.style.left = wb.focus[0] * 100 + '%';
          marker.style.top = wb.focus[1] * 100 + '%';
        }
        // Radius = guide_radius_per_f * F * long side; in percent of each side so a pane resize keeps it.
        var guide = qs('.wb-guide', overlay);
        var slider = dofSlider(phaseForm(5));
        var k = slider ? parseFloat(slider.getAttribute('data-dof-guide-radius') || '') : NaN;
        var f = dofFNumber(phaseForm(5));
        var w = overlay.offsetWidth;
        var h = overlay.offsetHeight;
        guide.hidden = marker.hidden || !(k > 0) || f === undefined || !w || !h;
        if (!guide.hidden) {
          var d = 2 * k * f * Math.max(w, h);
          guide.style.width = (d / w) * 100 + '%';
          guide.style.height = (d / h) * 100 + '%';
          guide.style.left = (wb.focus[0] - d / w / 2) * 100 + '%';
          guide.style.top = (wb.focus[1] - d / h / 2) * 100 + '%';
        }
      });
      var count = qs('[data-wb-rect-count]', root);
      if (count) count.textContent = '矩形 ' + wb.rects.length + ' か所';
      var readout = qs('[data-dof-focus-readout]', root);
      if (readout) readout.textContent = wb.focus ? 'ピント: [' + wb.focus[0] + ', ' + wb.focus[1] + ']' : '';
    }

    // ---- rendering ----
    function activeInputNode() {
      var id = inputOf(wb.active);
      return id ? nodeById(id) : null;
    }

    function unavailableText() {
      var input = activeInputNode();
      if (!input) return '';
      if (wb.active === 2 && input.kind === 'redraw' && input.method === 'canvas') {
        return '入力が redraw · canvas の出力なので light は使えません（canvas は IL で描くため、Anima の graph がありません）。スキップしてください。';
      }
      if (wb.active === 4 && input.delivered) return '納品済みの絵は、もう一度納品できません。前のフェーズに戻ってください。';
      if (wb.active === 5 && !input.delivered) return '納品していない絵にはボケをかけられません。納品のフェーズで納品してください。';
      return '';
    }

    function renderSteps() {
      qsa('[data-wb-step]', root).forEach(function (btn) {
        var k = Number(btn.getAttribute('data-wb-step'));
        if (k === 0) return;
        var p = pick(k);
        var kind = qs('[data-wb-step-kind]', btn);
        var text = '—';
        if (p && p.skip) {
          text = 'スキップ';
        } else if (p) {
          var n = nodeById(p.generation_id);
          text = n ? kindLabel(n) : '採用';
        } else if (reached(k)) {
          text = 'いま';
        }
        kind.textContent = text;
        btn.disabled = !reached(k);
        btn.classList.toggle('wb-step-on', k === wb.active);
        btn.classList.toggle('wb-step-open', !p);
      });
    }

    function renderStrip(list) {
      var strip = qs('[data-wb-strip]', root);
      strip.textContent = '';
      var adopted = pick(wb.active);
      list.forEach(function (item) {
        var btn = wbEl('button', 'wb-mini' + (item.key === wb.compareId ? ' wb-mini-on' : ''));
        btn.type = 'button';
        btn.setAttribute('data-wb-pick', item.key);
        btn.title = itemKind(item) + ' · ' + itemSummary(item);
        btn.setAttribute('aria-label', btn.title);
        var thumb = wbEl('div', 'wb-mini-thumb');
        if (item.node) {
          var img = document.createElement('img');
          img.src = '/g/' + item.node.short_id + '/preview';
          img.alt = item.node.short_id;
          thumb.appendChild(img);
          thumb.classList.toggle('wb-checker', item.node.delivered);
        }
        btn.appendChild(thumb);
        var bar = wbEl('span', 'wb-mini-rate');
        bar.style.background = item.node && item.node.rating ? WB_RATING_COLOR[item.node.rating] : 'transparent';
        btn.appendChild(bar);
        if (item.node && adopted && !adopted.skip && adopted.generation_id === item.node.id) btn.appendChild(wbEl('span', 'wb-mini-adopted'));
        if (item.pending) btn.appendChild(wbEl('span', 'wb-mini-running', '…'));
        strip.appendChild(btn);
      });
    }

    function renderAll(list, input) {
      var grid = qs('[data-wb-all]', root);
      grid.textContent = '';
      var inputTile = wbEl('figure', 'wb-tile wb-tile-input');
      var inputPane = wbEl('div', 'wb-tile-pane');
      if (input) fillPane(inputPane, input.id, 'input', input, null);
      inputTile.appendChild(inputPane);
      inputTile.appendChild(wbEl('figcaption', 'wb-tile-cap', captionWithMeta('入力 ' + (input ? kindLabel(input) : ''), input)));
      grid.appendChild(inputTile);
      var adopted = pick(wb.active);
      list.forEach(function (item) {
        var tile = wbEl('button', 'wb-tile' + (item.key === wb.compareId ? ' wb-tile-on' : ''));
        tile.type = 'button';
        tile.setAttribute('data-wb-pick', item.key);
        var pane = wbEl('div', 'wb-tile-pane');
        fillPane(pane, item.key, 'cmp', item.node, item.pending);
        tile.appendChild(pane);
        var isAdopted = item.node && adopted && !adopted.skip && adopted.generation_id === item.node.id;
        tile.appendChild(wbEl('span', 'wb-tile-cap mono', captionWithMeta(itemKind(item) + (isAdopted ? ' · 採用中' : ''), item.node)));
        grid.appendChild(tile);
      });
    }

    function renderPanes(list, input) {
      var inputPane = qs('[data-wb-input-pane]', root);
      var cmpPane = qs('[data-wb-cmp-pane]', root);
      var cmp = candidateByKey(wb.active, wb.compareId);
      qs('[data-wb-input-kind]', root).textContent = input ? kindLabel(input) : '';
      qs('[data-wb-input-meta]', root).textContent = imageMetaText(input);
      var hint = '';
      if (wb.active === 5) hint = 'クリックでピント';
      else if (wb.active === 3 && wb.partMode === 'rect') hint = 'ドラッグで矩形';
      qs('[data-wb-pane-hint]', root).textContent = hint;
      inputPane.classList.toggle('wb-pane-active', hint !== '');
      if (input) {
        fillPane(inputPane, input.id, 'input', input, null);
      } else {
        inputPane.textContent = '';
        inputPane.setAttribute('data-wb-key', '');
      }
      var adopted = pick(wb.active);
      if (cmp) {
        fillPane(cmpPane, cmp.key, 'cmp', cmp.node, cmp.pending);
        qs('[data-wb-cmp-kind]', root).textContent = itemKind(cmp);
        qs('[data-wb-cmp-status]', root).textContent = itemStatus(cmp);
        qs('[data-wb-cmp-badge]', root).textContent = cmp.node && adopted && !adopted.skip && adopted.generation_id === cmp.node.id ? '· 採用中' : '';
        qs('[data-wb-cmp-meta]', root).textContent = imageMetaText(cmp.node);
      } else {
        cmpPane.setAttribute('data-wb-key', 'none');
        cmpPane.removeAttribute('data-wb-imgpane');
        cmpPane.textContent = '';
        cmpPane.classList.remove('wb-checker');
        cmpPane.appendChild(wbEl('div', 'wb-empty', '候補はまだありません。右の欄から作ります。'));
        qs('[data-wb-cmp-kind]', root).textContent = '';
        qs('[data-wb-cmp-status]', root).textContent = '';
        qs('[data-wb-cmp-badge]', root).textContent = '';
        qs('[data-wb-cmp-meta]', root).textContent = '';
      }
      wbRenderCapActions(root, 'input', input);
      wbRenderCapActions(root, 'cmp', cmp && cmp.node);
    }

    function renderControls(list) {
      var cmp = candidateByKey(wb.active, wb.compareId);
      qsa('[data-wb-compare-mode]', root).forEach(function (b) {
        b.classList.toggle('wb-pill-on', b.getAttribute('data-wb-compare-mode') === wb.mode);
      });
      qs('[data-wb-skip]', root).textContent = wb.active === 5 ? 'ボケなしで完成にする' : 'このフェーズをスキップ（入力をそのまま次へ）';
      var adopt = qs('[data-wb-adopt]', root);
      var next = WB_PHASES[wb.active] ? WB_PHASES[wb.active].label : '';
      if (!cmp) {
        adopt.textContent = '候補を選んでください';
        adopt.disabled = true;
      } else if (cmp.pending) {
        adopt.textContent = '処理中です';
        adopt.disabled = true;
      } else {
        adopt.textContent = wb.active === 5 ? 'この候補で完成にする' : 'この候補を採用して「' + next + '」へ';
        adopt.disabled = false;
      }
      qs('[data-wb-done]', root).hidden = !pick(5);
    }

    function runBlocker() {
      if (!activeInputNode()) return '入力がありません';
      if (unavailableText()) return '';
      if (wb.active === 3 && wb.partMode === 'rect') {
        if (wb.rects.length === 0) return '矩形を 1 か所以上引いてください';
        if (qs('input[name="wb_patch"]', root).value.trim() === '') return '足す語を入力してください';
      }
      if (wb.active === 5 && !wb.focus) return 'ピントを置いてください（左の絵をクリック）';
      return null;
    }

    function renderPanel() {
      var phase = WB_PHASES[wb.active - 1];
      qs('[data-wb-phase-no]', root).textContent = String(wb.active);
      qs('[data-wb-phase-title]', root).textContent = phase.label;
      qsa('[data-wb-form]', root).forEach(function (form) {
        form.hidden = Number(form.getAttribute('data-wb-form')) !== wb.active;
      });
      var form = qs('[data-wb-form="' + wb.active + '"]', root);
      var unavailable = unavailableText();
      var note = qs('[data-wb-unavailable]', form);
      var body = qs('[data-wb-form-body]', form);
      if (note) {
        note.hidden = unavailable === '';
        note.textContent = unavailable;
      }
      if (body) body.hidden = unavailable !== '';
      var blocker = runBlocker();
      var run = qs('[data-wb-run]', root);
      run.hidden = unavailable !== '' || !activeInputNode();
      run.disabled = blocker !== null;
      run.textContent = blocker ? blocker : phase.label + 'を実行';
      qsa('[data-wb-part-panel]', root).forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-wb-part-panel') !== wb.partMode;
      });
      qsa('[data-wb-part-mode]', root).forEach(function (b) {
        b.classList.toggle('wb-pill-on', b.getAttribute('data-wb-part-mode') === wb.partMode);
      });
      var errorEl = qs('[data-wb-error]', root);
      errorEl.hidden = wb.error === '';
      errorEl.textContent = wb.error;
    }

    function render() {
      if (!candidateByKey(wb.active, wb.compareId)) wb.compareId = defaultCompare(wb.active);
      var list = candidates(wb.active);
      var input = activeInputNode();
      qs('[data-wb-pair]', root).hidden = wb.mode !== 'pair';
      qs('[data-wb-all]', root).hidden = wb.mode !== 'all';
      if (wb.mode === 'pair') renderPanes(list, input);
      else renderAll(list, input);
      renderSteps();
      renderStrip(list);
      renderControls(list);
      renderPanel();
      updateOverlays();
      fitPanel();
      imagePanes().forEach(layoutPane);
    }

    function goStep(k) {
      wb.active = k;
      wb.forcedInput = null;
      wb.compareId = null;
      wb.rects = [];
      wb.draft = null;
      wb.error = '';
      render();
    }

    // ---- picks ----
    // Picks implied by a Generation's own lineage: its phase, every ancestor's phase, and skips in between.
    function chainPicks(nodeId, upto) {
      var picks = {};
      var id = nodeId;
      var guard = 0;
      while (id && id !== rootId && guard < 50) {
        guard += 1;
        var n = nodeById(id);
        if (!n) break;
        if (n.phase && n.phase <= upto && !picks[String(n.phase)]) picks[String(n.phase)] = { generation_id: n.id };
        id = n.refines_generation_id;
      }
      for (var j = 1; j <= upto; j++) if (!picks[String(j)]) picks[String(j)] = { skip: true };
      return picks;
    }

    function samePicksUpTo(a, b, upto) {
      for (var j = 1; j <= upto; j++) {
        if (JSON.stringify(a[String(j)] || null) !== JSON.stringify(b[String(j)] || null)) return false;
      }
      return true;
    }

    async function savePicks(next) {
      var saved = await api('/api/v1/workbenches/' + rootId, 'PUT', { picks: next });
      wb.picks = saved.picks || next;
    }

    async function adopt() {
      var cmp = candidateByKey(wb.active, wb.compareId);
      if (!cmp || !cmp.node) return;
      var k = wb.active;
      var next = chainPicks(cmp.node.id, k);
      try {
        if (!samePicksUpTo(wb.picks, next, k)) await savePicks(next);
        track('workbench.adopt', { phase: k, generation_id: cmp.node.id });
      } catch (e) {
        trackError('workbench.adopt', e, { phase: k });
        alert('adopt failed: ' + e.message);
        return;
      }
      if (k < 5) goStep(k + 1);
      else render();
    }

    async function skip() {
      var k = wb.active;
      var input = inputOf(k);
      if (!input) return;
      var next = chainPicks(input, k - 1);
      next[String(k)] = { skip: true };
      try {
        await savePicks(next);
        track('workbench.skip', { phase: k });
      } catch (e) {
        trackError('workbench.skip', e, { phase: k });
        alert('skip failed: ' + e.message);
        return;
      }
      if (k < 5) goStep(k + 1);
      else render();
    }

    // ---- requests ----
    function phaseForm(k) {
      return qs('[data-wb-form="' + k + '"]', root);
    }

    function currentMethod() {
      var on = qs('[data-wb-method].wb-pill-on', root);
      return on ? on.getAttribute('data-wb-method') : 'hires';
    }

    // Builds { kind, options } for the active phase, or null (after telling the user why).
    function buildRun() {
      var k = wb.active;
      var form = phaseForm(k);
      if (k === 1) {
        if (currentMethod() === 'canvas') {
          return { kind: 'redraw', options: { method: 'canvas', denoise: Number(qs('input[name="wb_denoise"]', form).value), size: Number(qs('select[name="wb_size"]', form).value) } };
        }
        return { kind: 'redraw', options: { method: 'hires', hires: Number(qs('select[name="wb_hires"]', form).value), denoise: Number(qs('select[name="wb_hires_denoise"]', form).value) } };
      }
      if (k === 2) {
        var scene = qs('[data-wb-scene].wb-pill-on', form);
        return { kind: 'redraw', options: { method: 'light', scene: scene.getAttribute('data-wb-scene'), from: qs('[data-compass="light"]', form).getAttribute('data-value') } };
      }
      if (k === 3) {
        if (wb.partMode === 'auto') {
          var which = qs('select[name="wb_repair_parts"]', form).value;
          return { kind: 'repair', options: which === 'both' ? {} : { parts: [which] } };
        }
        for (var i = 0; i < wb.rects.length; i++) {
          for (var j = i + 1; j < wb.rects.length; j++) {
            if (wbRectsOverlap(wb.rects[i], wb.rects[j])) {
              wb.error = '矩形が重なっています。重ならないように引き直してください。';
              renderPanel();
              return null;
            }
          }
        }
        return { kind: 'masked_redraw', options: { regions: wb.rects.map(function (r) { return r.slice(); }), prompt_patch: qs('input[name="wb_patch"]', form).value.trim() } };
      }
      if (k === 4) {
        var options = deliverOptionsFrom(form, false);
        return options ? { kind: 'deliver', options: options } : null;
      }
      var scope = dofScopeFrom(form);
      if (!scope.figure && !scope.outline && !scope.backdrop) {
        wb.error = 'ボカす範囲を 1 つ以上選んでください。';
        renderPanel();
        return null;
      }
      return { kind: 'dof', options: { focus: [wb.focus[0], wb.focus[1]], f_number: dofFNumber(form), scope: scope, viewfinder: dofViewfinderFrom(form) } };
    }

    async function run() {
      var input = activeInputNode();
      if (!input || runBlocker() !== null) return;
      wb.error = '';
      var built = buildRun();
      if (!built) return;
      var runBtn = qs('[data-wb-run]', root);
      runBtn.disabled = true;
      try {
        var request = await postOptionRequest(built.kind, input.short_id, built.options, null, 'gui:workbench:' + built.kind + ':' + input.short_id + ':' + crypto.randomUUID());
        var item = {
          request_id: request.id,
          kind: built.kind,
          method: built.kind === 'redraw' ? built.options.method : null,
          phase: wb.active,
          options: built.options,
          source_generation_id: input.id,
          status: request.status || 'queued',
          created_at: request.created_at || '',
        };
        wb.pending.push(item);
        wb.compareId = 'p:' + request.id;
        track('workbench.run', { phase: wb.active, kind: built.kind, generation_id: input.short_id });
        startPolling();
      } catch (e) {
        trackError('workbench.run', e, { phase: wb.active });
        wb.error = built.kind + ' failed: ' + e.message;
      }
      render();
    }

    // The tree is the source of truth; a request that left pending either produced a node or failed.
    var syncing = false;
    async function syncTree() {
      if (syncing) return;
      syncing = true;
      try {
        var before = wb.pending.slice();
        var tree = await api('/api/v1/generations/' + rootId + '/tree');
        var stillPending = {};
        tree.pending.forEach(function (p) { stillPending[p.request_id] = true; });
        var local = {};
        before.forEach(function (p) { local[p.request_id] = p; });
        wb.nodes = tree.nodes;
        var merged = tree.pending.map(function (p) {
          var prev = local[p.request_id];
          return prev && prev.progress ? Object.assign({}, p, { progress: prev.progress }) : p;
        });
        // A request created moments ago may not be visible to the tree query yet.
        before.forEach(function (p) {
          if (!stillPending[p.request_id] && Date.now() - Date.parse(p.created_at || 0) < 3000) merged.push(p);
        });
        var vanished = before.filter(function (p) { return !stillPending[p.request_id] && merged.indexOf(p) === -1; });
        wb.pending = merged;
        for (var i = 0; i < vanished.length; i++) {
          var p = vanished[i];
          var detail = await api('/api/v1/requests/' + p.request_id).catch(function () { return null; });
          if (detail && detail.status === 'done' && detail.result && detail.result.generation_ids && detail.result.generation_ids[0]) {
            if (wb.compareId === 'p:' + p.request_id) wb.compareId = detail.result.generation_ids[0];
          } else {
            if (wb.compareId === 'p:' + p.request_id) wb.compareId = null;
            if (detail && detail.status === 'failed') wb.error = p.kind + ' failed: ' + (detail.error || '');
          }
        }
        if (wb.pending.length === 0) stopPolling();
        render();
      } catch (e) {
        trackError('workbench.sync', e, {});
      }
      syncing = false;
    }

    function startPolling() {
      if (wb.timer) return;
      wb.timer = setInterval(syncTree, 4000);
    }

    function stopPolling() {
      if (wb.timer) clearInterval(wb.timer);
      wb.timer = null;
    }

    viewerSocketOn('status', function (m) {
      var p = pendingByRequest(m.request_id);
      if (!p) return;
      if (m.status === 'queued' || m.status === 'running') {
        p.status = m.status;
        render();
      } else {
        syncTree();
      }
    });
    viewerSocketOn('progress', function (m) {
      var p = pendingByRequest(m.request_id);
      if (!p) return;
      p.progress = (m.phase || '') + (typeof m.step === 'number' && typeof m.total === 'number' ? ' ' + m.step + '/' + m.total : '');
      var pane = qs('[data-wb-cmp-pane] .wb-pending-note', root);
      if (pane && wb.compareId === 'p:' + p.request_id) pane.textContent = (p.status === 'queued' ? '待機中…' : '処理中…') + ' ' + p.progress;
    });
    viewerSocketConnect();

    document.addEventListener('chimera:rating', function (ev) {
      var n = nodeById(ev.detail.id);
      if (!n) return;
      n.rating = ev.detail.rating;
      render();
    });

    // ---- events ----
    root.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target : null;
      if (!t) return;
      var step = t.closest('[data-wb-step]');
      if (step && !step.disabled) return goStep(Number(step.getAttribute('data-wb-step')));
      var picked = t.closest('[data-wb-pick]');
      if (picked) {
        wb.compareId = picked.getAttribute('data-wb-pick');
        return render();
      }
      var mode = t.closest('[data-wb-compare-mode]');
      if (mode) {
        wb.mode = mode.getAttribute('data-wb-compare-mode');
        return render();
      }
      if (t.closest('[data-wb-skip]')) return skip();
      if (t.closest('[data-wb-adopt]')) return adopt();
      if (t.closest('[data-wb-run]')) return run();

      var method = t.closest('[data-wb-method]');
      if (method) {
        var m = method.getAttribute('data-wb-method');
        qsa('[data-wb-method]', root).forEach(function (b) { b.classList.toggle('wb-pill-on', b === method); });
        qsa('[data-wb-method-panel]', root).forEach(function (p) { p.hidden = p.getAttribute('data-wb-method-panel') !== m; });
        qs('[data-wb-method-note]', root).textContent = method.getAttribute('data-note') || '';
        return;
      }
      var word = t.closest('[data-wb-denoise-word]');
      if (word) {
        var range = qs('input[name="wb_denoise"]', root);
        range.value = word.getAttribute('data-wb-denoise-word');
        qs('[data-wb-denoise-readout]', root).textContent = range.value;
        return;
      }
      var scene = t.closest('[data-wb-scene]');
      if (scene) {
        qsa('[data-wb-scene]', root).forEach(function (b) { b.classList.toggle('wb-pill-on', b === scene); });
        qs('[data-wb-scene-note]', root).textContent = scene.getAttribute('data-note') || '';
        return;
      }
      var dir = t.closest('[data-compass="light"] [data-compass-dir]');
      if (dir) {
        var value = dir.getAttribute('data-compass-dir');
        setCompassValue(dir.closest('[data-compass]'), value);
        qs('[data-wb-light-readout]', root).textContent = 'from: ' + value;
        return;
      }
      var partMode = t.closest('[data-wb-part-mode]');
      if (partMode) {
        wb.partMode = partMode.getAttribute('data-wb-part-mode');
        wb.draft = null;
        return render();
      }
      if (t.closest('[data-wb-rect-clear]')) {
        wb.rects = [];
        wb.draft = null;
        return render();
      }
      var chip = t.closest('[data-wb-part-chip]');
      if (chip) {
        var field = qs('input[name="wb_patch"]', root);
        var text = chip.getAttribute('data-part-text') || chip.getAttribute('data-wb-part-chip');
        field.value = (field.value.trim() ? field.value.trim() + ', ' : '') + text;
        return renderPanel();
      }
      // initBookmark on document does the request; the node follows so a re-render keeps the new state.
      var bm = t.closest('[data-wb-bookmark]');
      if (bm) {
        var bmNode = nodeById(bm.getAttribute('data-id'));
        if (bmNode) bmNode.bookmark = bm.getAttribute('data-bookmarked') !== 'true';
        return;
      }
      var bg = t.closest('[data-wb-bg]');
      if (bg) {
        setDeliverBg(bg.getAttribute('data-wb-bg'));
        return;
      }
    });

    root.addEventListener('change', function (ev) {
      var radio = ev.target;
      if (radio instanceof HTMLInputElement && radio.type === 'radio' && radio.name === 'backdrop') {
        syncBackdropColor(phaseForm(4));
        if (radio.value === 'color') qs('input[name="backdrop_color"]', phaseForm(4)).focus();
      }
    });

    root.addEventListener('input', function (ev) {
      var input = ev.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.name === 'wb_denoise') qs('[data-wb-denoise-readout]', root).textContent = input.value;
      if (input.name === 'dof_f_stop') qs('[data-dof-f-readout]', root).textContent = 'f/' + dofFNumber(phaseForm(5));
      if (input.name === 'dof_f_stop') updateOverlays();
      if (input.name === 'wb_patch') renderPanel();
    });

    var drawing = null;
    root.addEventListener('pointerdown', function (ev) {
      var pane = ev.target.closest ? ev.target.closest('[data-wb-input-pane]') : null;
      if (!pane || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      var rectMode = wb.active === 3 && wb.partMode === 'rect';
      if (!rectMode && wb.active !== 5) return;
      var p = pointIn(pane, ev);
      if (!p || !p.inside) return;
      ev.preventDefault();
      try { pane.setPointerCapture(ev.pointerId); } catch (e) {}
      drawing = { pane: pane, x: p.x, y: p.y, moved: false, rect: rectMode };
      if (rectMode) {
        wb.draft = [wbRound(p.x), wbRound(p.y), wbRound(p.x), wbRound(p.y)];
        updateOverlays();
      }
    });

    root.addEventListener('pointermove', function (ev) {
      var pane = ev.target.closest ? ev.target.closest('[data-wb-imgpane]') : null;
      if (drawing) {
        var q = pointIn(drawing.pane, ev);
        if (q) {
          drawing.moved = drawing.moved || Math.abs(q.x - drawing.x) > 0.005 || Math.abs(q.y - drawing.y) > 0.005;
          if (drawing.rect) {
            var x = clamp01(q.x);
            var y = clamp01(q.y);
            wb.draft = [wbRound(Math.min(drawing.x, x)), wbRound(Math.min(drawing.y, y)), wbRound(Math.max(drawing.x, x)), wbRound(Math.max(drawing.y, y))];
          }
          wb.cursor = { x: clamp01(q.x), y: clamp01(q.y) };
        }
        return updateOverlays();
      }
      if (!pane) return;
      var p = pointIn(pane, ev);
      wb.cursor = p && p.inside ? { x: p.x, y: p.y } : null;
      updateOverlays();
    });

    root.addEventListener('pointerup', function (ev) {
      if (!drawing) return;
      var d = drawing;
      drawing = null;
      var p = pointIn(d.pane, ev);
      if (d.rect) {
        var r = wb.draft;
        wb.draft = null;
        if (r && r[2] - r[0] > 0.02 && r[3] - r[1] > 0.02) wb.rects.push(r);
      } else if (p && !d.moved) {
        wb.focus = [wbRound(clamp01(p.x)), wbRound(clamp01(p.y))];
      }
      renderPanel();
      updateOverlays();
    });

    root.addEventListener('pointercancel', function () {
      drawing = null;
      wb.draft = null;
      updateOverlays();
    });

    root.addEventListener('pointerleave', function () {
      if (drawing) return;
      wb.cursor = null;
      updateOverlays();
    });

    root.addEventListener('pointerout', function (ev) {
      if (drawing || !ev.relatedTarget || (ev.relatedTarget.closest && ev.relatedTarget.closest('[data-wb-imgpane]'))) return;
      wb.cursor = null;
      updateOverlays();
    });

    // A transparent delivery starts without bands; a backdrop one starts from the catalog's.
    function setDeliverBg(choice) {
      var form = phaseForm(4);
      qsa('[data-wb-bg]', root).forEach(function (b) { b.classList.toggle('wb-pill-on', b.getAttribute('data-wb-bg') === choice); });
      var radios = qsa('input[name="backdrop"]', form);
      var patterns = qs('[data-wb-backdrop-patterns]', root);
      patterns.hidden = choice === 'transparent';
      if (choice === 'transparent') {
        radios.forEach(function (r) { r.checked = r.value === 'transparent'; });
      } else if (!radios.some(function (r) { return r.checked && r.value !== 'transparent'; })) {
        var wanted = patterns.getAttribute('data-default');
        radios.forEach(function (r) { r.checked = r.value === wanted; });
        if (!radios.some(function (r) { return r.checked; })) {
          var first = qs('[data-wb-backdrop-first]', patterns);
          if (first) first.checked = true;
        }
      }
      var editor = qs('[data-outline-editor]', form);
      if (editor) {
        setOutlineList(editor, choice === 'transparent' ? [] : outlineDefaults(editor));
        setOutlineStroke(editor, editor.getAttribute('data-stroke-default') || 'even');
      }
      syncBackdropColor(form);
    }

    // The header and stepper wrap at varying heights; the panes and the panel measure from
    // where they start so the page ends at the viewport bottom with the run button in view.
    function fitPanel() {
      var panel = qs('.wb-panel', root);
      var pane = qs('.wb-pane', root);
      if (!panel || !pane) return;
      root.style.removeProperty('--wb-pane-h');
      root.style.setProperty('--wb-panel-top', Math.round(panel.getBoundingClientRect().top + window.scrollY) + 'px');
      if (window.matchMedia('(max-width: 900px)').matches) return;
      // A shorter pane can unwrap the controls row, so a second pass settles what the first left.
      for (var pass = 0; pass < 2; pass++) {
        var excess = document.documentElement.scrollHeight - window.innerHeight;
        if (excess <= 0 || pane.offsetHeight === 0) break;
        root.style.setProperty('--wb-pane-h', Math.floor(pane.getBoundingClientRect().height - excess) + 'px');
      }
    }

    // ---- start ----
    var at = initial.at ? wbNodeByShort(wb.nodes, initial.at) : null;
    if (at && at.phase) {
      wb.active = at.phase;
      wb.compareId = at.id;
      if (at.refines_generation_id !== inputOf(at.phase)) wb.forcedInput = at.refines_generation_id;
    } else {
      var open = 1;
      while (open < 5 && pick(open)) open += 1;
      wb.active = open;
    }
    var deliverForm = phaseForm(4);
    if (deliverForm) setDeliverBg('backdrop');
    window.addEventListener('resize', function () { fitPanel(); imagePanes().forEach(layoutPane); });
    render();
    if (wb.pending.length > 0) startPolling();
  }

  // リロール (/reroll/{short_id}): 左 = 元絵、右 = seed だけ変えた generate の 4 枚。比較ペイン・ルーペ・キャプションの操作はワークベンチと共有する。
  function initReroll() {
    var root = qs('[data-reroll]');
    if (!root) return;
    var state = {};
    try { state = JSON.parse(root.getAttribute('data-initial') || '{}'); } catch (e) { state = {}; }
    var rootId = root.getAttribute('data-root-id');
    var rr = { cursor: null, loupe: { on: true, zoom: 3 } };
    var progress = '';
    var HINTS = { queued: '待機中', running: '処理中', failed: '失敗', cancelled: '中止' };
    var sel = -1;
    var timer = null;
    var viewer = wbViewer(root, rr);
    viewer.trackCursor();
    var board = qs('[data-rr-board]', root);

    function rounds() { return state.rounds || []; }

    function latestRound() { var rs = rounds(); return rs.length ? rs[rs.length - 1] : null; }

    function current() { var rs = rounds(); return rs[sel] || null; }

    function inFlight() {
      var r = latestRound();
      return !!r && (r.request.status === 'queued' || r.request.status === 'running');
    }

    function selectRound(i) {
      sel = i;
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('round', String(i + 1));
        history.replaceState(null, '', url.toString());
      } catch (e) { /* the URL is a convenience */ }
    }

    var wanted = Number(new URLSearchParams(window.location.search).get('round'));
    sel = wanted >= 1 && wanted <= rounds().length ? wanted - 1 : rounds().length - 1;

    function setNote(pane, text) {
      if (pane.getAttribute('data-wb-key') !== 'note') {
        pane.setAttribute('data-wb-key', 'note');
        pane.removeAttribute('data-wb-imgpane');
        pane.textContent = '';
        pane.appendChild(wbEl('div', 'wb-empty', text));
      } else {
        qs('.wb-empty', pane).textContent = text;
      }
    }

    function noteFor() {
      var cur = current();
      var r = cur && cur.request;
      if (!r) return '未実行';
      if (r.status === 'queued') return '待機中…' + (progress ? ' ' + progress : '');
      if (r.status === 'running') return '処理中…' + (progress ? ' ' + progress : '');
      if (r.status === 'failed') return '失敗' + (r.error ? ': ' + r.error : '');
      if (r.status === 'cancelled') return 'キャンセル';
      return '画像なし';
    }

    function renderCap(side, node) {
      var box = qs('[data-wb-cap-actions="' + side + '"]', root);
      if (!node) return wbRenderCapActions(root, side, null);
      if (box.getAttribute('data-wb-cap-for') !== node.id) wbRenderCapActions(root, side, node);
    }

    function renderTabs() {
      var tabs = qs('[data-rr-tabs]', root);
      tabs.hidden = rounds().length === 0;
      tabs.textContent = '';
      rounds().forEach(function (round, i) {
        var b = wbEl('button', 'wb-pill' + (i === sel ? ' wb-pill-on' : ''), (i + 1) + ' 回目');
        b.type = 'button';
        b.setAttribute('data-rr-round', String(i));
        var hint = HINTS[round.request.status];
        if (hint) b.appendChild(wbEl('span', 'wb-meta', ' ' + hint));
        b.addEventListener('click', function () { selectRound(i); render(); });
        tabs.appendChild(b);
      });
    }

    function render() {
      var cur = current();
      var gens = cur ? cur.generations : [];
      renderTabs();
      viewer.fillPane(qs('[data-wb-input-pane]', root), state.root.id, 'input', state.root, null);
      qs('[data-rr-meta="input"]', root).textContent = imageMetaText(state.root);
      renderCap('input', state.root);
      for (var i = 0; i < 4; i++) {
        var node = gens[i] || null;
        var pane = qs('[data-rr-pane="' + i + '"]', root);
        if (node) viewer.fillPane(pane, node.id, 'cmp', node, null);
        else setNote(pane, noteFor());
        qs('[data-rr-meta="' + i + '"]', root).textContent = imageMetaText(node);
        renderCap('r' + i, node);
      }
      var run = qs('[data-rr-run]', root);
      run.hidden = !state.recipe;
      run.disabled = inFlight();
      run.textContent = inFlight() ? '処理中…' : rounds().length ? 'もう 4 枚振る' : '4 枚振る';
      viewer.updateCrosshair();
    }

    async function sync() {
      try {
        state = await api('/api/v1/generations/' + encodeURIComponent(rootId) + '/reroll');
        if (sel >= rounds().length) sel = rounds().length - 1;
        render();
        fitBoard();
        if (!inFlight()) stopPolling();
      } catch (e) {
        trackError('reroll.sync', e, {});
      }
    }

    function startPolling() {
      if (!timer) timer = setInterval(sync, 3000);
    }

    function stopPolling() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function showError(message) {
      var el = qs('[data-rr-error]', root);
      el.textContent = message;
      el.hidden = !message;
    }

    qs('[data-rr-run]', root).addEventListener('click', async function (ev) {
      var btn = ev.currentTarget;
      btn.disabled = true;
      showError('');
      try {
        state = await api('/api/v1/generations/' + encodeURIComponent(rootId) + '/reroll', 'POST');
        selectRound(rounds().length - 1);
        render();
        fitBoard();
        if (inFlight()) startPolling();
        track('reroll.run', { generation_id: rootId });
      } catch (e) {
        trackError('reroll.run', e, { generation_id: rootId });
        showError('リロールを積めませんでした: ' + e.message);
      } finally {
        btn.disabled = inFlight();
      }
    });

    document.addEventListener('chimera:rating', function (ev) {
      var all = [state.root];
      rounds().forEach(function (round) { all = all.concat(round.generations); });
      all.forEach(function (n) { if (n.id === ev.detail.id) n.rating = ev.detail.rating; });
    });
    viewerSocketOn('status', function (m) {
      var r = latestRound();
      if (r && m.request_id === r.request.id) sync();
    });
    viewerSocketOn('progress', function (m) {
      var r = latestRound();
      if (!r || m.request_id !== r.request.id || current() !== r) return;
      progress = (m.phase || '') + (typeof m.step === 'number' && typeof m.total === 'number' ? ' ' + m.step + '/' + m.total : '');
      qsa('[data-rr-pane] .wb-empty', root).forEach(function (el) { el.textContent = noteFor(); });
    });
    viewerSocketConnect();

    // The board is as tall as what fits between its top and the controls row below it, so the page needs no scroll.
    function fitBoard() {
      board.style.removeProperty('height');
      if (window.matchMedia('(max-width: 900px)').matches) return;
      var top = board.getBoundingClientRect().top + window.scrollY;
      var below = document.documentElement.scrollHeight - (top + board.offsetHeight);
      board.style.height = Math.max(window.innerHeight - top - below, 320) + 'px';
    }

    window.addEventListener('resize', function () { fitBoard(); viewer.imagePanes().forEach(viewer.layoutPane); });
    render();
    fitBoard();
    if (inFlight()) startPolling();
  }

  function wbNodeByShort(nodes, shortId) {
    for (var i = 0; i < nodes.length; i++) if (nodes[i].short_id === shortId) return nodes[i];
    return null;
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
    initOutlineEditors();
    initPromoteToProfile();
    initStyleCheck();
    initGalleryFilter();
    initGalleryView();
    initGalleryInfiniteScroll();
    initGalleryTimeline();
    initGalleryPending();
    initRequestLive();
    initWorkbench();
    initReroll();
    initNavQueue();
    initPopoverClose();
    initCompareBar();
    initCopyIdButtons();
    initCompareCols();
    initCompareSame();
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
