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
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  position: sticky;
  top: 0;
  z-index: 10;
}
.nav a { color: var(--text); font-weight: 600; }
.nav a.brand { color: var(--accent); margin-right: 0.5rem; }

.container { padding: 1.25rem; max-width: 1600px; margin: 0 auto; }

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
.card .thumb-link { display: block; background: #000; }
.card img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; }
.card-body { padding: 0.55rem 0.6rem 0.7rem; display: flex; flex-direction: column; gap: 0.4rem; }
.card-top-row { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; }
.short-id-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: var(--text); }

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

.kv-table { border-collapse: collapse; width: 100%; }
.kv-table td { padding: 0.2rem 0.5rem 0.2rem 0; vertical-align: top; font-size: 0.85rem; }
.kv-table td:first-child { color: var(--text-dim); white-space: nowrap; }

.gen-detail-hero { text-align: center; margin-bottom: 1rem; }
.gen-detail-hero img { max-width: 100%; max-height: 70vh; border-radius: 10px; border: 1px solid var(--border); }

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

.compare-columns { display: flex; gap: 1rem; flex-wrap: wrap; }
.compare-col { flex: 1 1 220px; max-width: 320px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem; }
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
  border-left: 3px solid var(--accent);
  background: rgba(124, 156, 245, 0.08);
}

.empty-state { color: var(--text-dim); padding: 2rem 0; }
.bookmark-section { margin-bottom: 2rem; }

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
#graph-svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
#graph-svg.dragging { cursor: grabbing; }

.graph-node { cursor: pointer; }
.graph-node-card { fill: var(--bg-elevated); stroke: var(--border); stroke-width: 1; }
.graph-node:hover .graph-node-card { stroke: var(--accent); }
.graph-node-noimg { fill: #000; }
.graph-node-shortid {
  fill: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
.graph-node-status { fill: var(--text-dim); font-size: 11px; }

.graph-edge path { fill: none; stroke-width: 2; }
.graph-edge.edge-reference path { stroke: var(--graph-reference); }
.graph-edge.edge-relation path { stroke: var(--graph-relation); stroke-dasharray: 7 5; }
.graph-edge.edge-story path { stroke: var(--graph-story); }
.graph-edge text {
  font-size: 10px;
  fill: var(--text-dim);
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3px;
  stroke-linejoin: round;
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
      throw new Error(message || ('request failed: ' + res.status));
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.indexOf('application/json') !== -1 ? res.json() : null;
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
  function initCompareBar() {
    const bar = document.getElementById('compare-bar');
    if (!bar) return;
    function update() {
      const checked = qsa('.compare-check:checked').map(function (c) { return c.value; });
      if (checked.length > 0) {
        bar.classList.remove('hidden');
        const displayCount = Math.min(checked.length, 9);
        qs('#compare-count', bar).textContent = 'Compare (' + displayCount + ')';
        qs('#compare-link', bar).setAttribute('href', '/compare?ids=' + checked.slice(0, 9).join(','));
      } else {
        bar.classList.add('hidden');
      }
    }
    document.addEventListener('change', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('compare-check')) update();
    });
    update();
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
  // Drags/zooms by rewriting the SVG's viewBox. Without JS the browser falls
  // back to the .graph-viewport container's native scrollbars (see style.css).
  function initGraphPanZoom() {
    var svg = document.getElementById('graph-svg');
    if (!svg) return;
    var parts = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    if (parts.length !== 4 || parts.some(function (n) { return isNaN(n); })) return;

    var vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };

    // The SVG fills its frame (100%/100%), so shape the viewBox to the frame's
    // aspect ratio (removes letterboxing and keeps cursor-to-viewBox math exact).
    // Initial view: fit the graph width; if the graph is taller than the frame,
    // anchor the newest (bottom) layer at the bottom edge so the frame fills
    // upward with ancestor rows instead of wasting space below the newest row.
    var contentH = vb.h;
    var frame = svg.getBoundingClientRect();
    if (frame.width > 0 && frame.height > 0) {
      var frameAspect = frame.width / frame.height;
      var newVbH = vb.w / frameAspect;
      if (newVbH >= contentH) {
        vb.y -= (newVbH - contentH) / 2;
      } else {
        vb.y = contentH - newVbH;
      }
      vb.h = newVbH;
    }

    var baseW = vb.w;
    var minScale = 0.2;
    var maxScale = 3;

    var initial = { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
    apply();

    function apply() {
      svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
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
    }

    // Trackpad-first wheel handling: pinch gestures reach the browser as wheel
    // events with ctrlKey=true (Cmd+scroll opts in explicitly), so those zoom
    // around the cursor; a plain two-finger scroll pans instead of zooming.
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        zoomAt(ev.clientX, ev.clientY, Math.exp(ev.deltaY * 0.01));
        return;
      }
      var rect = svg.getBoundingClientRect();
      vb.x += (ev.deltaX / rect.width) * vb.w;
      vb.y += (ev.deltaY / rect.height) * vb.h;
      apply();
    }, { passive: false });

    // Safari sends pinches as gesture* events instead of ctrl+wheel.
    var gestureScale = 1;
    svg.addEventListener('gesturestart', function (ev) {
      ev.preventDefault();
      gestureScale = ev.scale;
    });
    svg.addEventListener('gesturechange', function (ev) {
      ev.preventDefault();
      if (!ev.scale) return;
      zoomAt(ev.clientX, ev.clientY, gestureScale / ev.scale);
      gestureScale = ev.scale;
    });

    var controls = document.getElementById('graph-zoom-controls');
    if (controls) {
      controls.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-zoom]') : null;
        if (!btn) return;
        var rect = svg.getBoundingClientRect();
        var action = btn.getAttribute('data-zoom');
        if (action === 'in') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
        else if (action === 'out') zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
        else {
          vb.x = initial.x; vb.y = initial.y; vb.w = initial.w; vb.h = initial.h;
          apply();
        }
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
    });
    window.addEventListener('mousemove', function (ev) {
      if (!dragging) return;
      var rect = svg.getBoundingClientRect();
      vb.x -= ((ev.clientX - lastX) / rect.width) * vb.w;
      vb.y -= ((ev.clientY - lastY) / rect.height) * vb.h;
      lastX = ev.clientX;
      lastY = ev.clientY;
      apply();
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
      svg.classList.remove('dragging');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initRating();
    initBookmark();
    initTagAdd();
    initTagRemove();
    initTagSuggestions();
    initNoteForm();
    initCompareBar();
    initStoryRelationEdit();
    initGraphPanZoom();
  });
})();
`;
