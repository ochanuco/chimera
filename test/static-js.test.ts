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

  it('resolves a tri-state dial group\'s "on" mode to boolean true, not the word "on"', () => {
    expect(appJs).toContain("if (group.classList.contains('dial-group-tristate') && mode === 'on') return true;");
  });

  it('redrawOptionsFrom builds exactly one method per request and omits blank fields', () => {
    expect(appJs).toContain('function redrawOptionsFrom(form)');
    expect(appJs).toContain("var hires = { method: 'hires', hires: Number(qs('select[name=\"hires\"]', form).value) };");
    expect(appJs).toContain("if (hiresDenoise !== '') hires.denoise = Number(hiresDenoise);");
    expect(appJs).toContain("return { method: 'light', scene: qs('select[name=\"light_scene\"]', form).value, from: lightFromSelect(form).value };");
    expect(appJs).toContain("var options = { method: 'canvas' };");
    expect(appJs).toContain("if (denoiseRaw !== '') options.denoise = Number(denoiseRaw);");
    expect(appJs).toContain("if (sizeRaw !== '') options.size = Number(sizeRaw);");
    expect(appJs).toContain("if (route !== '') options.route = route;");
  });

  it('redrawOptionsFrom sends keep_regions only with drawn regions, and keep_strength only alongside them', () => {
    expect(appJs).toContain('var regions = regionsFor(form);\n    if (regions.length > 0) {\n      options.keep_regions = regions;');
    expect(appJs).toContain("if (keepStrengthRaw !== '') options.keep_strength = Number(keepStrengthRaw);");
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
    expect(appJs).toContain("var labels = { redraw: '描き直し', deliver: '納品', dof: 'ボケ', repair: 'repair', masked_redraw: 'masked redraw', finalize: 'finalize' };");
    expect(appJs).toContain("return labels[kind] || kind || '';");
    expect(appJs).toContain('requestKindLabel(kind) + \' · \'');
    expect(appJs).toContain('kind.textContent = requestKindLabel(request.kind);');
  });

  it('redrawOptionsFrom reads keep regions from the per-form region-drawing state', () => {
    expect(appJs).toContain('function regionsFor(form)');
    expect(appJs).toContain('var regions = regionsFor(form);');
  });

  it('drives the style check from the workbench viewer: pose picker, pin replacement with confirm, and an any-ID left pane', () => {
    expect(appJs).toContain('function wbViewer(root, wb)');
    expect(appJs).toContain('var viewer = wbViewer(root, sc);');
    expect(appJs).toContain("api('/api/v1/generations/' + q.result.id + '/pose-reference', 'POST', {})");
    expect(appJs).toContain("url.searchParams.set('pose', sc.poses[i].pose);");
    expect(appJs).toContain("'/api/v1/style-check/' + encodeURIComponent(recipe)");
    expect(appJs).not.toContain('data-style-check-compare-add');
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
