import { describe, expect, it } from 'vitest';
import { appJs, styleCss } from '../src/ui/static';

describe('served app.js', () => {
  // appJs is a template literal, so a stray '\n' or '\s' inside it silently
  // changes the served script; a parse failure there disables every init.
  it('parses as a script', () => {
    expect(() => new Function(appJs)).not.toThrow();
  });

  it('wires up the nav queue pill against the summary endpoint', () => {
    expect(appJs).toContain('initNavQueue');
    expect(appJs).toContain('/api/v1/requests/summary');
  });

  it('wires up the pose reference pin button against the pose-reference endpoint', () => {
    expect(appJs).toContain('initPoseReference');
    expect(appJs).toContain('/pose-reference');
  });

  it('edits the outline list in place: add, remove, reorder, reset to the catalog default, and a stroke shading of even or a direction', () => {
    expect(appJs).toContain('function outlinesFrom(editor)');
    expect(appJs).toContain("t.closest('[data-outline-add]')");
    expect(appJs).toContain("t.closest('[data-outline-reset]')");
    expect(appJs).toContain("row && t.closest('[data-outline-remove]')");
    expect(appJs).toContain('function setOutlineStroke(editor, value)');
  });

  it('resolves the random backdrop to one of the pattern radios before sending', () => {
    const start = appJs.indexOf("if (backdropMode === 'random') {");
    expect(start).toBeGreaterThan(0);
    expect(appJs.slice(start, start + 300)).toContain('input[name="backdrop"][data-backdrop-pattern]');
  });

  it('sends backdrop null for the transparent choice and checks the colour format', () => {
    expect(appJs).toContain("var backdrop = backdropMode === 'transparent' ? null : backdropMode;");
    expect(appJs).toContain("alert('背景色は #RRGGBB で指定してください')");
  });

  it('labels request kinds 描き直し / 納品 / ボケ / repair / masked redraw / finalize without defaulting new kinds to finalize', () => {
    expect(appJs).toContain("var labels = { redraw: '描き直し', deliver: '納品', dof: 'ボケ', saturation: '彩度', repair: 'repair', masked_redraw: 'masked redraw', finalize: 'finalize' };");
    expect(appJs).toContain("return labels[kind] || kind || '';");
    expect(appJs).toContain('requestKindLabel(kind) + \' · \'');
    expect(appJs).toContain('kind.textContent = requestKindLabel(request.kind);');
  });

  it('drives the style check as a pose list: per-pose re-render, and good + repin as two existing calls', () => {
    expect(appJs).toContain('function initStyleCheck()');
    expect(appJs).toContain("'/api/v1/style-check/' + encodeURIComponent(recipe)");
    expect(appJs).toContain("api('/api/v1/generations/' + p.result.id + '/rating', 'PUT', { rating: 'good' })");
    expect(appJs).toContain("api('/api/v1/generations/' + p.result.id + '/pose-reference', 'POST', {})");
  });

  it('opens the style check compare viewer from a row, keeps it in ?pose=, and closes / steps with the keyboard', () => {
    expect(appJs).toContain('var viewer = wbViewer(viewerEl, sc);');
    expect(appJs).toContain('openViewer(p.pose);');
    expect(appJs).toContain("url.searchParams.set('pose', name);");
    expect(appJs).toContain("url.searchParams.delete('pose');");
    expect(appJs).toContain("window.addEventListener('popstate'");
    expect(appJs).toContain("if (ev.key === 'Escape') closeViewer();");
    expect(appJs).toContain("ev.key === 'ArrowLeft' || ev.key === 'k'");
    expect(appJs).toContain("ev.key === 'ArrowRight' || ev.key === 'j'");
  });

  it('drives the reroll screen from the workbench viewer and the shared caption actions, polling its own endpoint', () => {
    expect(appJs).toContain('function initReroll()');
    expect(appJs).toContain('var viewer = wbViewer(root, rr);');
    expect(appJs).toContain("wbRenderCapActions(root, 'input', input);");
    expect(appJs).toContain("wbRenderCapActions(root, side, node);");
    expect(appJs).toContain("'/api/v1/generations/' + encodeURIComponent(rootId) + '/reroll'");
    expect(appJs).toContain("url.searchParams.set('round', String(i + 1));");
    expect(appJs).toContain('data-rr-round');
  });
});
