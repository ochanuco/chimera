import { fnv1a } from './static';

// 枠エディタ (/frame/:shortId, docs/ui.md「枠」) のクライアント。合成の規則は docs/worker-protocol.md「stage」の frame と同じ。
// テンプレートリテラルなのでバッククォートと ${ は書かない。
export const frameJs = `
(function () {
  'use strict';
  var root = document.getElementById('frame-editor');
  if (!root) return;
  var init = JSON.parse(root.getAttribute('data-initial') || '{}');
  var canvas = document.getElementById('fr-canvas');
  var stageEl = document.getElementById('fr-stage');
  var ctx = canvas.getContext('2d');

  var WORK_MAX = 1280;
  var SCAN_MAX = 480;
  var MAX_STROKES = 200;
  var MAX_STROKE_POINTS = 2000;
  var MAX_TOTAL_POINTS = 20000;
  var MIN_SIZE = 0.02;
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_LINE_COLOR = '#4a3152';
  // 斜線の線の柄（docs/worker-protocol.md「stage」の frame）。値は線の幅 w に対する比。
  var SLASH = { period: 2.2, thickness: 0.14, offset: 0.34 };
  // 斜線が見える太さの下限（長辺に対する %）。斜線に切り替えたとき、これより細ければここまで上げる。
  var SLASH_MIN_WIDTH = 1.2;
  var DEFAULT_RIM_COLOR = '#2e2236';
  var SIDE_KEYS = ['top', 'right', 'bottom', 'left'];
  // 辺の名前から [x0, y0, x1, y1] の添字へ。
  var EDGE_INDEX = { left: 0, top: 1, right: 2, bottom: 3 };
  var EDGE_SIDE = ['left', 'top', 'right', 'bottom'];

  function $(sel) { return root.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clampCoord(v) { return clamp(v, -1, 2); }

  // ---- 状態 ----
  var state = {
    box: [0, 0, 1, 1],
    sides: { top: 'out', right: 'cut', bottom: 'cut', left: 'cut' },
    backdrop: null,
    lineColor: DEFAULT_LINE_COLOR,
    lineWidth: 0.6,
    linePattern: 'solid',
    rimColor: DEFAULT_RIM_COLOR,
    rimWidth: 0.25,
    paper: '#ffffff',
    // 辺ごとの余白の有無（frame.expand）と、出力範囲の辺 [x0, y0, x1, y1]（null は自動。frame.canvas）。
    margin: { top: true, right: true, bottom: true, left: true },
    edges: [null, null, null, null],
    strokes: [],
    shadowOn: false,
    shadowKeep: null
  };
  var ui = { tool: 'box', brush: 2, hover: null };
  var history = [];
  var future = [];
  var gesturing = false;
  var submittedKey = null;

  function copyState() {
    return {
      box: state.box.slice(),
      sides: { top: state.sides.top, right: state.sides.right, bottom: state.sides.bottom, left: state.sides.left },
      backdrop: state.backdrop ? { kind: state.backdrop.kind, name: state.backdrop.name, color: state.backdrop.color } : null,
      lineColor: state.lineColor,
      lineWidth: state.lineWidth,
      linePattern: state.linePattern,
      rimColor: state.rimColor,
      rimWidth: state.rimWidth,
      paper: state.paper,
      margin: { top: state.margin.top, right: state.margin.right, bottom: state.margin.bottom, left: state.margin.left },
      edges: state.edges.slice(),
      // 描き終えたストロークは書き換えないので、配列だけ写せばよい。
      strokes: state.strokes.slice(),
      shadowOn: state.shadowOn,
      shadowKeep: state.shadowKeep
    };
  }

  function begin() {
    if (gesturing) return;
    gesturing = true;
    history.push(copyState());
    if (history.length > 200) history.shift();
    future = [];
  }
  function end() { gesturing = false; }

  function restore(snap) {
    state = snap;
    maskDirty = true;
    syncControls();
    recomputeView();
    schedule();
  }
  function undo() {
    if (!history.length) return;
    future.push(copyState());
    restore(history.pop());
  }
  function redo() {
    if (!future.length) return;
    history.push(copyState());
    restore(future.pop());
  }

  // ---- 画像と作業用 canvas ----
  var imgFigure = null;
  var imgOutline = null;
  var picW = 1;
  var picH = 1;
  var workW = 1;
  var workH = 1;
  var figW = null;
  var outW = null;
  var maskC = null;
  var maskedFig = null;
  var maskedOut = null;
  var maskDirty = true;
  var layersDirty = true;
  var autoBox = null;
  var autoDirty = true;
  var thumbs = {};

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('画像を読み込めません: ' + url)); };
      img.src = url;
    });
  }

  function longSide() { return Math.max(picW, picH); }
  // 納品画像の長辺に対する % を、x / y の分数に直す。
  function pctToX(pct) { return (pct / 100) * longSide() / picW; }
  function pctToY(pct) { return (pct / 100) * longSide() / picH; }

  function lineWidthPct() { return state.lineWidth > 0 ? state.lineWidth : 0; }
  function rimWidthPct() { return state.rimWidth > 0 ? state.rimWidth : 0; }
  // 枠全体（外の rim + line + 内の rim）の半幅。cut の境目と自動 canvas はこの縁で決まる。
  function frameHalfPct() { return lineWidthPct() / 2 + rimWidthPct(); }

  function alphaBBox(source, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    var w = Math.max(1, Math.round(source.width * scale));
    var h = Math.max(1, Math.round(source.height * scale));
    var c = makeCanvas(w, h);
    var cx = c.getContext('2d');
    cx.drawImage(source, 0, 0, w, h);
    var data = cx.getImageData(0, 0, w, h).data;
    var x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
  }

  // ---- keep-mask (docs/worker-protocol.md「stage」の frame) ----
  function drawStroke(mctx, stroke, from) {
    var pts = stroke.points;
    mctx.save();
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    mctx.lineWidth = (stroke.width / 100) * Math.max(workW, workH);
    if (stroke.mode === 'erase') {
      mctx.globalCompositeOperation = 'destination-out';
      mctx.strokeStyle = '#000';
      mctx.fillStyle = '#000';
    } else {
      mctx.globalCompositeOperation = 'source-over';
      mctx.strokeStyle = '#fff';
      mctx.fillStyle = '#fff';
    }
    if (pts.length === 1) {
      mctx.beginPath();
      mctx.arc(pts[0][0] * workW, pts[0][1] * workH, mctx.lineWidth / 2, 0, Math.PI * 2);
      mctx.fill();
    } else {
      var start = Math.max(0, from - 1);
      mctx.beginPath();
      mctx.moveTo(pts[start][0] * workW, pts[start][1] * workH);
      for (var i = start + 1; i < pts.length; i++) mctx.lineTo(pts[i][0] * workW, pts[i][1] * workH);
      mctx.stroke();
    }
    mctx.restore();
  }

  // [lo, hi) に中心が入る画素の範囲。
  function pixelSpan(lo, hi, size) {
    return [clamp(Math.ceil(lo * size - 0.5), 0, size), clamp(Math.ceil(hi * size - 0.5), 0, size)];
  }

  function clearBand(mctx, x0, y0, x1, y1) {
    var xs = pixelSpan(x0, x1, workW);
    var ys = pixelSpan(y0, y1, workH);
    if (xs[1] > xs[0] && ys[1] > ys[0]) mctx.clearRect(xs[0], ys[0], xs[1] - xs[0], ys[1] - ys[0]);
  }

  function rebuildMask() {
    var mctx = maskC.getContext('2d');
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, workW, workH);
    mctx.fillStyle = '#fff';
    mctx.fillRect(0, 0, workW, workH);
    var hx = pctToX(frameHalfPct());
    var hy = pctToY(frameHalfPct());
    var b = state.box;
    // 切る辺は枠の内縁を境にした半平面。画素の中心が残る側にあれば残す。
    if (state.sides.left === 'cut') {
      mctx.clearRect(0, 0, clamp(Math.ceil((b[0] + hx) * workW - 0.5), 0, workW), workH);
    }
    if (state.sides.right === 'cut') {
      var rs = clamp(Math.floor((b[2] - hx) * workW - 0.5) + 1, 0, workW);
      mctx.clearRect(rs, 0, workW - rs, workH);
    }
    if (state.sides.top === 'cut') {
      mctx.clearRect(0, 0, workW, clamp(Math.ceil((b[1] + hy) * workH - 0.5), 0, workH));
    }
    if (state.sides.bottom === 'cut') {
      var bs = clamp(Math.floor((b[3] - hy) * workH - 0.5) + 1, 0, workH);
      mctx.clearRect(0, bs, workW, workH - bs);
    }
    // behind の辺は、その辺の枠の帯（角まで含む）の下だけ抜く。枠は背景側にあるので、枠がキャラの上に見える。
    var bx0 = b[0] - hx, by0 = b[1] - hy, bx1 = b[2] + hx, by1 = b[3] + hy;
    if (state.sides.top === 'behind') clearBand(mctx, bx0, b[1] - hy, bx1, b[1] + hy);
    if (state.sides.right === 'behind') clearBand(mctx, b[2] - hx, by0, b[2] + hx, by1);
    if (state.sides.bottom === 'behind') clearBand(mctx, bx0, b[3] - hy, bx1, b[3] + hy);
    if (state.sides.left === 'behind') clearBand(mctx, b[0] - hx, by0, b[0] + hx, by1);
    for (var i = 0; i < state.strokes.length; i++) drawStroke(mctx, state.strokes[i], 0);
    maskDirty = false;
    layersDirty = true;
  }

  function applyMask() {
    var pairs = [[figW, maskedFig], [outW, maskedOut]];
    for (var i = 0; i < pairs.length; i++) {
      var c = pairs[i][1].getContext('2d');
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, workW, workH);
      c.drawImage(pairs[i][0], 0, 0);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(maskC, 0, 0);
      c.globalCompositeOperation = 'source-over';
    }
    layersDirty = false;
    autoDirty = true;
  }

  function computeAuto() {
    var sum = document.createElement('canvas');
    var scale = Math.min(1, SCAN_MAX / Math.max(workW, workH));
    sum.width = Math.max(1, Math.round(workW * scale));
    sum.height = Math.max(1, Math.round(workH * scale));
    var sctx = sum.getContext('2d');
    sctx.drawImage(maskedOut, 0, 0, sum.width, sum.height);
    sctx.drawImage(maskedFig, 0, 0, sum.width, sum.height);
    var vis = alphaBBox(sum, SCAN_MAX);
    var hx = pctToX(frameHalfPct());
    var hy = pctToY(frameHalfPct());
    var b = state.box;
    var r = [b[0] - hx, b[1] - hy, b[2] + hx, b[3] + hy];
    if (vis) r = [Math.min(r[0], vis[0]), Math.min(r[1], vis[1]), Math.max(r[2], vis[2]), Math.max(r[3], vis[3])];
    var mx = pctToX(4);
    var my = pctToY(4);
    var m = state.margin;
    autoBox = [
      clamp(r[0] - mx, m.left ? -1 : 0, 2),
      clamp(r[1] - my, m.top ? -1 : 0, 2),
      clamp(r[2] + mx, -1, m.right ? 2 : 1),
      clamp(r[3] + my, -1, m.bottom ? 2 : 1)
    ];
    autoDirty = false;
  }

  function refreshDerived() {
    if (maskDirty) rebuildMask();
    if (layersDirty) applyMask();
    if (autoDirty) computeAuto();
  }

  function canvasRect() {
    return autoBox.map(function (v, i) { return state.edges[i] === null ? v : state.edges[i]; });
  }

  function canvasValid() {
    var c = canvasRect();
    return c[0] < c[2] && c[1] < c[3];
  }

  // ---- 表示範囲 ----
  var view = [0, 0, 1, 1];
  function recomputeView() {
    if (!maskC) return;
    refreshDerived();
    var c = canvasRect();
    var r = [Math.min(0, state.box[0], c[0]), Math.min(0, state.box[1], c[1]), Math.max(1, state.box[2], c[2]), Math.max(1, state.box[3], c[3])];
    var px = (r[2] - r[0]) * 0.08;
    var py = (r[3] - r[1]) * 0.08;
    view = [r[0] - px, r[1] - py, r[2] + px, r[3] + py];
    layout();
  }

  var cssW = 1;
  var cssH = 1;
  var dpr = 1;
  function layout() {
    var availW = Math.max(200, stageEl.clientWidth);
    var availH = Math.max(280, window.innerHeight * 0.82);
    var vwPx = (view[2] - view[0]) * picW;
    var vhPx = (view[3] - view[1]) * picH;
    var s = Math.min(availW / vwPx, availH / vhPx);
    cssW = Math.max(1, Math.floor(vwPx * s));
    cssH = Math.max(1, Math.floor(vhPx * s));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    schedule();
  }

  function X(x) { return ((x - view[0]) / (view[2] - view[0])) * cssW; }
  function Y(y) { return ((y - view[1]) / (view[3] - view[1])) * cssH; }
  function fromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    return [
      view[0] + ((e.clientX - rect.left) / rect.width) * (view[2] - view[0]),
      view[1] + ((e.clientY - rect.top) / rect.height) * (view[3] - view[1])
    ];
  }

  // ---- 描画 ----
  var rafId = 0;
  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; render(); });
  }

  var hatch = null;
  function hatchPattern() {
    if (hatch) return hatch;
    var c = makeCanvas(10, 10);
    var h = c.getContext('2d');
    h.strokeStyle = 'rgba(255,255,255,0.18)';
    h.lineWidth = 1;
    h.beginPath();
    h.moveTo(0, 10);
    h.lineTo(10, 0);
    h.stroke();
    hatch = ctx.createPattern(c, 'repeat');
    return hatch;
  }

  function drawBackdrop() {
    var b = state.box;
    var x = X(b[0]), y = Y(b[1]), w = X(b[2]) - x, h = Y(b[3]) - y;
    var bd = state.backdrop;
    if (bd && bd.kind === 'solid') {
      ctx.fillStyle = bd.color;
      ctx.fillRect(x, y, w, h);
      return;
    }
    var img = bd && bd.kind === 'pattern' ? thumbs[bd.name] : null;
    if (img && img.complete && img.naturalWidth) {
      // 柄は box の長辺で正規化した座標で描かれる (左上原点) ので、サムネイルを長辺比で拡大し左上から敷き詰めると倍率が揃う。
      var k = Math.max(w, h) / Math.max(img.naturalWidth, img.naturalHeight);
      var pat = ctx.createPattern(img, 'repeat');
      pat.setTransform(new DOMMatrix([k, 0, 0, k, x, y]));
      ctx.save();
      ctx.fillStyle = pat;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = '#c9c9d0';
      ctx.fillRect(x, y, w, h);
    }
  }

  // rim の色で枠全体のリングを塗り、その上に line のリングを塗る。
  function drawLine() {
    drawRing(frameHalfPct(), state.rimColor);
    if (state.linePattern === 'slash') {
      drawRing(lineWidthPct() / 2, state.paper);
      drawRing(lineWidthPct() / 2, slashPattern());
    } else {
      drawRing(lineWidthPct() / 2, state.lineColor);
    }
  }

  // u = (x + y) / √2 の周期の縞なので、x・y とも周期 × √2 の正方形を敷けば継ぎ目なく続く。
  // 座標は出力キャンバスの左上を原点にした納品の px。
  var slashCache = null;
  function slashPattern() {
    var w = (lineWidthPct() / 100) * longSide();
    var scale = (cssW / (view[2] - view[0])) / picW * dpr;
    var period = SLASH.period * w;
    var side = period * Math.SQRT2;
    var n = Math.max(4, Math.min(512, Math.round(side * scale)));
    var key = [w, n, state.lineColor].join(',');
    if (!slashCache || slashCache.key !== key) {
      var tile = makeCanvas(n, n);
      var tctx = tile.getContext('2d');
      var img = tctx.createImageData(n, n);
      var rgb = [parseInt(state.lineColor.slice(1, 3), 16), parseInt(state.lineColor.slice(3, 5), 16), parseInt(state.lineColor.slice(5, 7), 16)];
      var s1 = 0.2 * period;
      var s2 = s1 + SLASH.offset * w;
      var t = SLASH.thickness * w;
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var x = ((c + 0.5) / n) * side;
          var y = ((r + 0.5) / n) * side;
          var phase = ((x + y) / Math.SQRT2) % period;
          var a = Math.max(clamp(Math.min(phase - s1, s1 + t - phase) + 0.5, 0, 1), clamp(Math.min(phase - s2, s2 + t - phase) + 0.5, 0, 1));
          var o = (r * n + c) * 4;
          img.data[o] = rgb[0];
          img.data[o + 1] = rgb[1];
          img.data[o + 2] = rgb[2];
          img.data[o + 3] = Math.round(a * 255);
        }
      }
      tctx.putImageData(img, 0, 0);
      slashCache = { key: key, tile: tile };
    }
    var pat = ctx.createPattern(slashCache.tile, 'repeat');
    var cr = canvasRect();
    var k = (side * (cssW / (view[2] - view[0])) / picW) / n;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, X(cr[0]), Y(cr[1])]));
    return pat;
  }

  function drawRing(halfPct, color) {
    if (halfPct <= 0) return;
    var hx = pctToX(halfPct);
    var hy = pctToY(halfPct);
    var b = state.box;
    ctx.fillStyle = color;
    var ox0 = X(b[0] - hx), oy0 = Y(b[1] - hy), ox1 = X(b[2] + hx), oy1 = Y(b[3] + hy);
    var ix0 = X(b[0] + hx), iy0 = Y(b[1] + hy), ix1 = X(b[2] - hx), iy1 = Y(b[3] - hy);
    if (ix1 <= ix0 || iy1 <= iy0) {
      ctx.fillRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
      return;
    }
    ctx.beginPath();
    ctx.rect(ox0, oy0, ox1 - ox0, oy1 - oy0);
    ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    ctx.fill('evenodd');
  }

  var HANDLE_R = 6;
  function handlePoints(r) {
    var mx = (r[0] + r[2]) / 2;
    var my = (r[1] + r[3]) / 2;
    return [
      { id: 'nw', x: r[0], y: r[1], hx: -1, hy: -1 },
      { id: 'ne', x: r[2], y: r[1], hx: 1, hy: -1 },
      { id: 'se', x: r[2], y: r[3], hx: 1, hy: 1 },
      { id: 'sw', x: r[0], y: r[3], hx: -1, hy: 1 },
      { id: 'n', x: mx, y: r[1], hx: 0, hy: -1 },
      { id: 'e', x: r[2], y: my, hx: 1, hy: 0 },
      { id: 's', x: mx, y: r[3], hx: 0, hy: 1 },
      { id: 'w', x: r[0], y: my, hx: -1, hy: 0 }
    ];
  }

  function drawHandles(r, color, list) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(X(r[0]), Y(r[1]), X(r[2]) - X(r[0]), Y(r[3]) - Y(r[1]));
    var hs = list || handlePoints(r);
    for (var i = 0; i < hs.length; i++) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.rect(X(hs[i].x) - HANDLE_R / 2 - 1, Y(hs[i].y) - HANDLE_R / 2 - 1, HANDLE_R + 2, HANDLE_R + 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function render() {
    if (!maskC) return;
    refreshDerived();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = state.paper;
    ctx.fillRect(0, 0, cssW, cssH);
    drawBackdrop();
    drawLine();
    ctx.drawImage(maskedOut, X(0), Y(0), X(1) - X(0), Y(1) - Y(0));
    ctx.drawImage(maskedFig, X(0), Y(0), X(1) - X(0), Y(1) - Y(0));

    // 出力範囲の外は暗くしてハッチをかける。
    var cr = canvasRect();
    var cx0 = X(cr[0]), cy0 = Y(cr[1]), cx1 = X(cr[2]), cy1 = Y(cr[3]);
    ctx.beginPath();
    ctx.rect(0, 0, cssW, cssH);
    ctx.rect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    ctx.fillStyle = 'rgba(16,18,28,0.62)';
    ctx.fill('evenodd');
    ctx.fillStyle = hatchPattern();
    ctx.fill('evenodd');

    // 画像の枠
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,120,140,0.7)';
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(X(0), Y(0), X(1) - X(0), Y(1) - Y(0));

    // 出力範囲の辺は、自動なら破線、固定なら実線。
    ctx.strokeStyle = '#7c9cf5';
    ctx.lineWidth = 1.5;
    var segs = [[cx0, cy0, cx0, cy1], [cx0, cy0, cx1, cy0], [cx1, cy0, cx1, cy1], [cx0, cy1, cx1, cy1]];
    for (var e = 0; e < 4; e++) {
      ctx.setLineDash(state.edges[e] === null ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(segs[e][0], segs[e][1]);
      ctx.lineTo(segs[e][2], segs[e][3]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (ui.tool === 'box') drawHandles(state.box, '#f2c94c');
    if (ui.tool === 'canvas') drawHandles(canvasRect(), '#7c9cf5', canvasHandles());
    if ((ui.tool === 'erase' || ui.tool === 'restore') && ui.hover) {
      var pxPerX = cssW / (view[2] - view[0]);
      var rad = (ui.brush / 100) * longSide() / picW * pxPerX / 2;
      ctx.strokeStyle = ui.tool === 'erase' ? '#ff7b80' : '#5fbf7b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(ui.hover[0]), Y(ui.hover[1]), Math.max(1, rad), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- 操作 ----
  var drag = null;
  function activeRect() { return ui.tool === 'canvas' ? canvasRect() : state.box; }

  // 出力範囲で動かせるのは余白ありの辺だけ。余白なしの辺は元画像の端に留まる。
  function edgeMovable(i) { return state.margin[EDGE_SIDE[i]]; }

  function canvasHandles() {
    return handlePoints(canvasRect()).filter(function (h) {
      return (h.hx < 0 && edgeMovable(0)) || (h.hx > 0 && edgeMovable(2)) || (h.hy < 0 && edgeMovable(1)) || (h.hy > 0 && edgeMovable(3));
    });
  }

  function hitHandle(r, e) {
    var tol = e.pointerType === 'touch' ? 18 : 10;
    var rect = canvas.getBoundingClientRect();
    var hs = ui.tool === 'canvas' ? canvasHandles() : handlePoints(r);
    var best = null;
    var bestD = tol;
    for (var i = 0; i < hs.length; i++) {
      var dx = rect.left + X(hs[i].x) - e.clientX;
      var dy = rect.top + Y(hs[i].y) - e.clientY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= bestD) { best = hs[i]; bestD = d; }
    }
    return best;
  }

  function inside(r, p) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; }

  function applyRectDrag(d, p) {
    var dx = p[0] - d.start[0];
    var dy = p[1] - d.start[1];
    var s = d.rect;
    var r;
    if (d.mode === 'move') {
      var w = s[2] - s[0];
      var h = s[3] - s[1];
      var nx = clamp(s[0] + dx, -1, 2 - w);
      var ny = clamp(s[1] + dy, -1, 2 - h);
      r = [nx, ny, nx + w, ny + h];
    } else {
      r = s.slice();
      if (d.handle.hx < 0) r[0] = clamp(s[0] + dx, -1, s[2] - MIN_SIZE);
      if (d.handle.hx > 0) r[2] = clamp(s[2] + dx, s[0] + MIN_SIZE, 2);
      if (d.handle.hy < 0) r[1] = clamp(s[1] + dy, -1, s[3] - MIN_SIZE);
      if (d.handle.hy > 0) r[3] = clamp(s[3] + dy, s[1] + MIN_SIZE, 2);
    }
    d.moved = true;
    if (ui.tool === 'canvas') {
      // 動かした辺だけを固定する。余白なしの辺は自動のまま。
      for (var i = 0; i < 4; i++) if (r[i] !== s[i] && edgeMovable(i)) state.edges[i] = r[i];
    } else {
      state.box = r;
      maskDirty = true;
    }
  }

  function strokePointCount() {
    var n = 0;
    for (var i = 0; i < state.strokes.length; i++) n += state.strokes[i].points.length;
    return n;
  }

  function newStroke(p) {
    var s = { mode: ui.tool, width: r4(Math.max(0.2, ui.brush)), points: [[r4(clampCoord(p[0])), r4(clampCoord(p[1]))]] };
    state.strokes.push(s);
    return s;
  }

  function addPoint(p) {
    var stroke = drag.stroke;
    var last = stroke.points[stroke.points.length - 1];
    var q = [r4(clampCoord(p[0])), r4(clampCoord(p[1]))];
    var dx = (q[0] - last[0]) * picW;
    var dy = (q[1] - last[1]) * picH;
    if (Math.sqrt(dx * dx + dy * dy) < 0.5) return;
    if (stroke.points.length >= MAX_STROKE_POINTS) {
      drag.stroke = stroke = newStroke(last);
    }
    stroke.points.push(q);
    var mctx = maskC.getContext('2d');
    drawStroke(mctx, stroke, stroke.points.length - 1);
    layersDirty = true;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!maskC || e.button > 0) return;
    var p = fromEvent(e);
    if (ui.tool === 'box' || ui.tool === 'canvas') {
      var r = activeRect();
      var handle = hitHandle(r, e);
      if (!handle && (ui.tool === 'canvas' || !inside(r, p))) return;
      begin();
      drag = { mode: handle ? 'resize' : 'move', handle: handle, start: p, rect: r.slice() };
    } else {
      begin();
      drag = { mode: 'brush', stroke: newStroke(p) };
      drawStroke(maskC.getContext('2d'), drag.stroke, 0);
      layersDirty = true;
    }
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    schedule();
  });

  canvas.addEventListener('pointermove', function (e) {
    var p = fromEvent(e);
    ui.hover = p;
    if (drag) {
      if (drag.mode === 'brush') {
        var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        if (!events.length) events = [e];
        for (var i = 0; i < events.length; i++) addPoint(fromEvent(events[i]));
      } else {
        applyRectDrag(drag, p);
      }
    } else if (ui.tool === 'box' || ui.tool === 'canvas') {
      var r = activeRect();
      var h = hitHandle(r, e);
      canvas.style.cursor = h ? (h.hx && h.hy ? (h.hx * h.hy > 0 ? 'nwse-resize' : 'nesw-resize') : h.hx ? 'ew-resize' : 'ns-resize') : ui.tool === 'box' && inside(r, p) ? 'move' : 'default';
    }
    schedule();
  });

  function finish() {
    if (!drag) return;
    if (drag.mode !== 'brush' && !drag.moved) history.pop();
    drag = null;
    end();
    recomputeView();
    syncControls();
    schedule();
  }
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', function () { if (!drag) { ui.hover = null; schedule(); } });

  // ---- コントロール ----
  function setPill(el, on) {
    el.classList.toggle('wb-pill-on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncControls() {
    $all('[data-fr-tool]').forEach(function (el) { setPill(el, el.getAttribute('data-fr-tool') === ui.tool); });
    $all('[data-fr-side]').forEach(function (el) {
      setPill(el, state.sides[el.getAttribute('data-fr-side')] === el.getAttribute('data-fr-side-mode'));
    });
    $all('[data-fr-margin]').forEach(function (el) {
      setPill(el, state.margin[el.getAttribute('data-fr-margin')] === (el.getAttribute('data-fr-margin-mode') === 'on'));
    });
    $all('[data-fr-edge-reset]').forEach(function (el) {
      el.hidden = state.edges[EDGE_INDEX[el.getAttribute('data-fr-edge-reset')]] === null;
    });
    $all('[data-fr-shadow]').forEach(function (el) { setPill(el, (el.getAttribute('data-fr-shadow') === 'on') === state.shadowOn); });
    var bd = state.backdrop;
    $all('[data-fr-backdrop]').forEach(function (el) {
      el.classList.toggle('fr-backdrop-on', !!bd && bd.kind === 'pattern' && bd.name === el.getAttribute('data-fr-backdrop'));
    });
    $('[data-fr-backdrop-solid]').classList.toggle('fr-backdrop-on', !!bd && bd.kind === 'solid');
    if (bd && bd.kind === 'solid') {
      $('#fr-solid-color').value = bd.color;
      $('#fr-solid-hex').value = bd.color;
    }
    $('#fr-line-color').value = state.lineColor;
    $('#fr-line-width').value = String(state.lineWidth);
    $all('[data-fr-line-pattern]').forEach(function (el) { setPill(el, el.getAttribute('data-fr-line-pattern') === state.linePattern); });
    $('#fr-line-readout').textContent = String(state.lineWidth);
    $('#fr-rim-color').value = state.rimColor;
    $('#fr-rim-width').value = String(state.rimWidth);
    $('#fr-rim-readout').textContent = String(state.rimWidth);
    $('#fr-paper').value = state.paper;
    $('#fr-brush').value = String(ui.brush);
    $('#fr-brush-readout').textContent = String(ui.brush);
    $('[data-fr-tool="canvas"]').hidden = !SIDE_KEYS.some(function (k) { return state.margin[k]; });
    if (ui.tool === 'canvas' && $('[data-fr-tool="canvas"]').hidden) ui.tool = 'box';
    updateStatus();
  }

  function buildOptions() {
    var options = {};
    var bd = state.backdrop;
    if (bd) options.backdrop = bd.kind === 'solid' ? bd.color : bd.name;
    if (!state.shadowOn) options.shadow_from = null;
    else if (state.shadowKeep) options.shadow_from = state.shadowKeep;
    var frame = {
      box: state.box.map(r4),
      sides: { top: state.sides.top, right: state.sides.right, bottom: state.sides.bottom, left: state.sides.left },
      line: state.lineWidth > 0 ? { color: state.lineColor, width: r4(state.lineWidth), pattern: state.linePattern } : null,
      rim: state.rimWidth > 0 ? { color: state.rimColor, width: r4(state.rimWidth) } : null,
      paper: state.paper
    };
    frame.expand = { top: state.margin.top, right: state.margin.right, bottom: state.margin.bottom, left: state.margin.left };
    frame.canvas = state.edges.map(function (v) { return v === null ? null : r4(v); });
    if (state.strokes.length) {
      frame.strokes = state.strokes.map(function (s) {
        return { mode: s.mode, width: s.width, points: s.points.map(function (p) { return [p[0], p[1]]; }) };
      });
    }
    options.frame = frame;
    return options;
  }

  function updateStatus() {
    var strokes = state.strokes.length;
    var points = strokePointCount();
    var over = strokes > MAX_STROKES || points > MAX_TOTAL_POINTS;
    $('#fr-count-strokes').textContent = String(strokes);
    $('#fr-count-points').textContent = String(points);
    $('#fr-count-strokes').parentNode.classList.toggle('fr-over', over);
    $('#fr-undo').disabled = !history.length;
    $('#fr-redo').disabled = !future.length;
    $('#fr-clear-strokes').disabled = !strokes;
    var submit = $('#fr-submit');
    var same = submittedKey !== null && submittedKey === JSON.stringify(buildOptions());
    var flipped = !!autoBox && !canvasValid();
    submit.disabled = over || flipped || same || !maskC;
    if (over) setStatus('ストロークか点が上限を超えています。ブラシを減らしてください。', true);
    else if (flipped) setStatus('出力範囲の辺が向かいの辺を越えています。範囲の辺を動かすか自動に戻してください。', true);
    else if (!same && $('#fr-status').getAttribute('data-kind') === 'error-limit') setStatus('', false);
  }

  function setStatus(text, isError, linkHref, linkText) {
    var el = $('#fr-status');
    el.textContent = text;
    el.setAttribute('data-kind', isError ? 'error-limit' : '');
    el.classList.toggle('fr-over', !!isError);
    if (linkHref) {
      el.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = linkHref;
      a.textContent = linkText;
      el.appendChild(a);
    }
  }

  function changed() { updateStatus(); recomputeView(); schedule(); }

  $all('[data-fr-tool]').forEach(function (el) {
    el.addEventListener('click', function () {
      ui.tool = el.getAttribute('data-fr-tool');
      canvas.style.cursor = ui.tool === 'erase' || ui.tool === 'restore' ? 'none' : 'default';
      syncControls();
      schedule();
    });
  });

  $all('[data-fr-side]').forEach(function (el) {
    el.addEventListener('click', function () {
      begin();
      state.sides[el.getAttribute('data-fr-side')] = el.getAttribute('data-fr-side-mode');
      end();
      maskDirty = true;
      syncControls();
      changed();
    });
  });

  $all('[data-fr-backdrop]').forEach(function (el) {
    el.addEventListener('click', function () {
      begin();
      state.backdrop = { kind: 'pattern', name: el.getAttribute('data-fr-backdrop') };
      end();
      loadThumb(state.backdrop.name);
      syncControls();
      changed();
    });
  });
  $('[data-fr-backdrop-solid]').addEventListener('click', function () {
    begin();
    var color = state.backdrop && state.backdrop.kind === 'solid' ? state.backdrop.color : $('#fr-solid-color').value;
    state.backdrop = { kind: 'solid', color: color };
    end();
    syncControls();
    changed();
  });
  function setSolid(color) {
    begin();
    state.backdrop = { kind: 'solid', color: color };
    syncControls();
    changed();
  }
  $('#fr-solid-color').addEventListener('input', function (e) { setSolid(e.target.value); });
  $('#fr-solid-color').addEventListener('change', end);
  $('#fr-solid-hex').addEventListener('input', function (e) {
    if (HEX_RE.test(e.target.value)) setSolid(e.target.value.toLowerCase());
  });
  $('#fr-solid-hex').addEventListener('change', end);

  function bindRange(sel, apply) {
    var el = $(sel);
    el.addEventListener('input', function () {
      begin();
      apply(el.value);
      syncControls();
      changed();
    });
    el.addEventListener('change', end);
  }
  bindRange('#fr-line-color', function (v) { state.lineColor = v; });
  bindRange('#fr-rim-color', function (v) { state.rimColor = v; });
  bindRange('#fr-rim-width', function (v) { state.rimWidth = r4(parseFloat(v)); maskDirty = true; });
  bindRange('#fr-paper', function (v) { state.paper = v; });
  $all('[data-fr-line-pattern]').forEach(function (el) {
    el.addEventListener('click', function () {
      var pattern = el.getAttribute('data-fr-line-pattern');
      if (pattern === state.linePattern) return;
      begin();
      state.linePattern = pattern;
      if (pattern === 'slash' && state.lineWidth < SLASH_MIN_WIDTH) {
        state.lineWidth = SLASH_MIN_WIDTH;
        maskDirty = true;
      }
      end();
      syncControls();
      changed();
    });
  });
  bindRange('#fr-line-width', function (v) { state.lineWidth = r4(parseFloat(v)); maskDirty = true; });
  $('#fr-brush').addEventListener('input', function (e) {
    ui.brush = parseFloat(e.target.value);
    $('#fr-brush-readout').textContent = String(ui.brush);
    schedule();
  });

  $all('[data-fr-margin]').forEach(function (el) {
    el.addEventListener('click', function () {
      var side = el.getAttribute('data-fr-margin');
      var on = el.getAttribute('data-fr-margin-mode') === 'on';
      if (state.margin[side] === on) return;
      begin();
      state.margin[side] = on;
      if (!on) state.edges[EDGE_INDEX[side]] = null;
      end();
      autoDirty = true;
      syncControls();
      changed();
    });
  });

  $all('[data-fr-edge-reset]').forEach(function (el) {
    el.addEventListener('click', function () {
      begin();
      state.edges[EDGE_INDEX[el.getAttribute('data-fr-edge-reset')]] = null;
      end();
      syncControls();
      changed();
    });
  });

  $all('[data-fr-shadow]').forEach(function (el) {
    el.addEventListener('click', function () {
      begin();
      state.shadowOn = el.getAttribute('data-fr-shadow') === 'on';
      end();
      syncControls();
      changed();
    });
  });

  $('#fr-undo').addEventListener('click', undo);
  $('#fr-redo').addEventListener('click', redo);
  $('#fr-clear-strokes').addEventListener('click', function () {
    if (!state.strokes.length) return;
    begin();
    state.strokes = [];
    end();
    maskDirty = true;
    syncControls();
    changed();
  });

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    var t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'text') return;
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  });

  window.addEventListener('resize', function () { if (maskC) layout(); });

  // ---- 送信 ----
  function newKey() {
    var id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    return 'gui:frame:' + init.base.short_id + ':' + id;
  }

  $('#fr-submit').addEventListener('click', function () {
    var options = buildOptions();
    var snapshot = JSON.stringify(options);
    var submit = $('#fr-submit');
    submit.disabled = true;
    setStatus('送信中', false);
    fetch('/api/v1/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'stage',
        payload: { generation_id: init.base.short_id, options: options },
        idempotency_key: newKey(),
        created_by: 'gui'
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) {
          var msg = r.body && r.body.error && r.body.error.message ? r.body.error.message : '送信に失敗しました';
          setStatus(msg, true);
          submit.disabled = false;
          return;
        }
        submittedKey = snapshot;
        setStatus('stage を積みました。', false, '/work/' + init.base.short_id + '?at=' + init.base.short_id, 'ワークベンチで見る');
        updateStatus();
      })
      .catch(function () {
        setStatus('送信に失敗しました', true);
        submit.disabled = false;
      });
  });

  // ---- 初期化 ----
  function loadThumb(name) {
    if (thumbs[name]) return;
    var bd = null;
    for (var i = 0; i < init.backdrops.length; i++) if (init.backdrops[i].name === name) bd = init.backdrops[i];
    if (!bd || !bd.thumbnail) return;
    var img = new Image();
    img.onload = schedule;
    img.src = bd.thumbnail;
    thumbs[name] = img;
  }

  function validRect(r) {
    return Array.isArray(r) && r.length === 4 && r.every(function (v) { return typeof v === 'number'; }) && r[0] < r[2] && r[1] < r[3];
  }

  function applyInitial(opts) {
    if (typeof opts.backdrop === 'string') {
      state.backdrop = HEX_RE.test(opts.backdrop) ? { kind: 'solid', color: opts.backdrop.toLowerCase() } : { kind: 'pattern', name: opts.backdrop };
    }
    if (opts.shadow_from === null) state.shadowOn = false;
    else if (typeof opts.shadow_from === 'string') state.shadowKeep = opts.shadow_from;
    var f = opts.frame;
    if (!f) return;
    if (validRect(f.box)) state.box = f.box.slice();
    if (f.sides) SIDE_KEYS.forEach(function (k) { if (f.sides[k] === 'cut' || f.sides[k] === 'out' || f.sides[k] === 'behind') state.sides[k] = f.sides[k]; });
    if (f.line === null) state.lineWidth = 0;
    else if (f.line) {
      if (typeof f.line.color === 'string' && HEX_RE.test(f.line.color)) state.lineColor = f.line.color.toLowerCase();
      if (typeof f.line.width === 'number') state.lineWidth = f.line.width;
      if (f.line.pattern === 'solid' || f.line.pattern === 'slash') state.linePattern = f.line.pattern;
    }
    if (f.rim === null) state.rimWidth = 0;
    else if (f.rim) {
      if (typeof f.rim.color === 'string' && HEX_RE.test(f.rim.color)) state.rimColor = f.rim.color.toLowerCase();
      if (typeof f.rim.width === 'number') state.rimWidth = f.rim.width;
    }
    if (typeof f.paper === 'string' && HEX_RE.test(f.paper)) state.paper = f.paper.toLowerCase();
    if (typeof f.expand === 'boolean') SIDE_KEYS.forEach(function (k) { state.margin[k] = f.expand; });
    else if (f.expand && typeof f.expand === 'object') SIDE_KEYS.forEach(function (k) { state.margin[k] = f.expand[k] !== false; });
    if (Array.isArray(f.canvas) && f.canvas.length === 4) {
      state.edges = f.canvas.map(function (v) { return typeof v === 'number' ? v : null; });
    }
    SIDE_KEYS.forEach(function (k) { if (!state.margin[k]) state.edges[EDGE_INDEX[k]] = null; });
    if (Array.isArray(f.strokes)) state.strokes = f.strokes.map(function (s) { return { mode: s.mode, width: s.width, points: s.points.map(function (p) { return [p[0], p[1]]; }) }; });
  }

  Promise.all([loadImage(init.layers.figure), loadImage(init.layers.outline)])
    .then(function (imgs) {
      imgFigure = imgs[0];
      imgOutline = imgs[1];
      picW = imgFigure.naturalWidth;
      picH = imgFigure.naturalHeight;
      var scale = Math.min(1, WORK_MAX / Math.max(picW, picH));
      workW = Math.max(1, Math.round(picW * scale));
      workH = Math.max(1, Math.round(picH * scale));
      figW = makeCanvas(workW, workH);
      outW = makeCanvas(workW, workH);
      maskC = makeCanvas(workW, workH);
      maskedFig = makeCanvas(workW, workH);
      maskedOut = makeCanvas(workW, workH);
      figW.getContext('2d').drawImage(imgFigure, 0, 0, workW, workH);
      outW.getContext('2d').drawImage(imgOutline, 0, 0, workW, workH);

      var fig = alphaBBox(figW, SCAN_MAX);
      if (fig) {
        var fh = fig[3] - fig[1];
        state.box = [clampCoord(fig[0] - 0.04), clampCoord(fig[1] + 0.3 * fh), clampCoord(fig[2] + 0.04), Math.min(1, fig[3] + 0.02)];
      } else {
        state.box = [0.1, 0.3, 0.9, 1];
      }
      if (init.backdrops.length) state.backdrop = { kind: 'pattern', name: init.backdrops[0].name };
      else state.backdrop = { kind: 'solid', color: '#ffffff' };
      if (init.defaults) {
        var d = { sides: init.defaults.sides || undefined, paper: init.defaults.paper || undefined };
        if (init.defaults.line) d.line = init.defaults.line;
        if (init.defaults.rim) d.rim = init.defaults.rim;
        if (init.defaults.expand !== null) d.expand = init.defaults.expand;
        applyInitial({ frame: d });
      }
      if (init.initial) {
        // 復元では shadow_from の省略は「納品の影を継ぐ」なので影ありに戻す。
        state.shadowOn = init.initial.shadow_from !== null;
        applyInitial(init.initial);
      }
      if (state.backdrop && state.backdrop.kind === 'pattern') loadThumb(state.backdrop.name);

      var note = document.getElementById('fr-loading');
      if (note) note.remove();
      syncControls();
      recomputeView();
      updateStatus();
      schedule();
    })
    .catch(function (err) {
      // 読み込み表示を消した後の初期化の失敗も見えるように、状態欄とコンソールにも出す。
      console.error(err);
      var note = document.getElementById('fr-loading');
      if (note) note.textContent = err.message;
      else setStatus(err.message, true);
    });
})();
`;

export const frameAssetVersion = fnv1a(frameJs);
