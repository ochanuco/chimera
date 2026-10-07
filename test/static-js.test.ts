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

  it('shows only the chosen redraw method\'s fields, and hides the keep-region overlay outside canvas', () => {
    expect(appJs).toContain('function syncRedrawMethod(form)');
    expect(appJs).toContain("panel.hidden = panel.getAttribute('data-redraw-panel') !== method;");
    expect(appJs).toContain("state.overlay.style.display = method === 'canvas' ? '' : 'none';");
    expect(appJs).toContain("radio.name !== 'redraw_method'");
    expect(styleCss).toContain('.option-group[hidden] { display: none; }');
  });

  it('optionsFrom dispatches on the form kind, and the submit handler posts that kind with a kind-prefixed idempotency key', () => {
    expect(appJs).toContain("if (kind === 'redraw') return redrawOptionsFrom(form);");
    expect(appJs).toContain('return deliverOptionsFrom(form, quiet);');
    expect(appJs).toContain('const kind = formKind(form);');
    expect(appJs).toContain('postOptionRequest(kind, shortId, options, profile)');
    expect(appJs).toContain("idempotency_key: idempotencyKey || ('gui:' + kind + ':' + generationShortId + ':' + crypto.randomUUID()),");
    expect(appJs).toContain("alert(kind + ' failed: ' + e.message);");
    expect(appJs).not.toContain("kind: 'finalize'");
  });

  it('deliverOptionsFrom has no redraw or repair keys', () => {
    const body = appJs.split('function deliverOptionsFrom(form, quiet)')[1]?.split('function optionsFrom')[0] ?? '';
    expect(body).not.toContain('deliver_only');
    expect(body).not.toContain('repair');
    expect(body).not.toContain('hires');
    expect(body).not.toContain('options.denoise');
  });

  it('dofOptionsFrom builds focus, f_number, scope and viewfinder from the form, and refuses a missing focus or an empty scope', () => {
    expect(appJs).toContain("return { focus: [focus[0], focus[1]], f_number: dofFNumber(form), scope: scope, viewfinder: dofViewfinderFrom(form) };");
    expect(appJs).toContain('return slider && stops.length > 0 ? stops[Number(slider.value)] : undefined;');
    expect(appJs).toContain("if (!quiet) alert('画像をクリックしてピント位置を置いてください');");
    expect(appJs).toContain("if (!scope.figure && !scope.outline && !scope.backdrop) {");
    expect(appJs).toContain("if (kind === 'dof') return dofOptionsFrom(form, quiet);");
  });

  it('never sends the retired stroke_light none or dof from the deliver form', () => {
    const body = appJs.split('function deliverOptionsFrom(form, quiet)')[1]?.split('// worker-protocol.md「dof」')[0] ?? '';
    expect(body).not.toContain('dof');
    expect(body).not.toContain("'none'");
    expect(body).not.toContain('stroke_style');
    expect(body).toContain('options.outlines = outlinesFrom(editor);');
    expect(body).toContain('if (options.outlines.length > 0) options.stroke_light = outlineStrokeValue(editor);');
  });

  it('renders the dof options in the preview and the outline list in the deliver preview', () => {
    expect(appJs).toContain("parts.push('ピント ' + value[0] + ', ' + value[1]);");
    expect(appJs).toContain("parts.push('f/' + value);");
    expect(appJs).toContain("if (deliver && (key === 'backdrop' || key === 'light' || key === 'outlines' || key === 'stroke_light')) return;");
  });

  it('edits the outline list in place: add, remove, reorder, reset to the catalog default, and a stroke shading of even or a direction', () => {
    expect(appJs).toContain('function outlinesFrom(editor)');
    expect(appJs).toContain("t.closest('[data-outline-add]')");
    expect(appJs).toContain("t.closest('[data-outline-reset]')");
    expect(appJs).toContain("row && t.closest('[data-outline-remove]')");
    expect(appJs).toContain('function setOutlineStroke(editor, value)');
    expect(appJs).toContain("setOutlineList(editor, Array.isArray(options.outlines) ? options.outlines : outlineDefaults(editor));");
  });

  it('sends light with its own direction and enables the direction only with a scene', () => {
    expect(appJs).toContain("options.light = { scene: lightScene.value, from: lightFromSelect(form).value };");
    expect(appJs).toContain("fromSelect.disabled = !scene || scene.value === '';");
    expect(appJs).toContain("select.name !== 'light_scene'");
  });

  it('sends backdrop null for the transparent choice and checks the colour format', () => {
    expect(appJs).toContain("var backdrop = backdropMode === 'transparent' ? null : backdropMode;");
    expect(appJs).toContain("alert('backdrop color must be #RRGGBB')");
  });

  it('restores outlines, stroke_light and light from a profile', () => {
    expect(appJs).toContain('applyOutlinesToForm(form, options);');
    expect(appJs).toContain('applyLightToForm(form, options);');
    expect(appJs).toContain("parts.push('光源 '");
    expect(appJs).not.toContain('applyHiresToForm');
    expect(appJs).not.toContain('applyDofToForm');
  });

  it('previews keep_regions as a count and prefixes the preview with the profile for a deliver form', () => {
    expect(appJs).toContain("parts.push(key + '=' + value.length + '箇所');");
    expect(appJs).toContain("if (profile) parts.push('profile ' + profile.name");
    expect(appJs).toContain("preview.textContent = '送信内容: ' + parts.join(' · ');");
  });

  it('applies a profile only through the profile buttons of a form (deliver forms render them)', () => {
    expect(appJs).toContain("ev.target.closest('.profile-group .dial-btn')");
    expect(appJs).toContain('applyProfileOptionsToForm(form, options);');
  });

  it('labels request kinds 描き直し / 納品 / ボケ / repair / masked redraw / finalize without defaulting new kinds to finalize', () => {
    expect(appJs).toContain("var labels = { redraw: '描き直し', deliver: '納品', dof: 'ボケ', repair: 'repair', masked_redraw: 'masked redraw', finalize: 'finalize' };");
    expect(appJs).toContain("return labels[kind] || kind || '';");
    expect(appJs).toContain('requestKindLabel(kind) + \' · \'');
    expect(appJs).toContain('kind.textContent = requestKindLabel(request.kind);');
  });

  it('keeps each form\'s region overlay separate, so redraw keep-regions and deliver focus placement coexist', () => {
    expect(appJs).toContain("overlay.setAttribute('data-owner', owner);");
    expect(appJs).toContain("qs('.repair-region-overlay[data-owner=\"' + owner + '\"]', parent)");
  });

  it('draws a clipped, click-through dof guide circle sized by guide_radius_per_f * F * long side and updated with the focus and F', () => {
    expect(appJs).toContain('function updateDofGuide(form)');
    expect(appJs).toContain("slider.getAttribute('data-dof-guide-radius')");
    expect(appJs).toContain('var d = 2 * k * f * Math.max(w, h);');
    expect(appJs).toContain("var show = !!focus && k > 0 && f !== undefined;");
    expect(appJs).toContain("guideClip.className = 'dof-guide-clip';");
    expect(appJs).toContain('var resync = function () { syncRepairRegionOverlayGeometry(state); updateDofGuide(form); };');
    expect(styleCss).toMatch(/\.dof-guide-clip \{[^}]*overflow: hidden; pointer-events: none;/);
    expect(styleCss).toMatch(/\.dof-guide-circle \{[^}]*pointer-events: none;/);
  });

  it('places the dof focus through the repair-region overlay only while region drawing is off', () => {
    expect(appJs).toContain("state.overlay.classList.toggle('dof-focus-on', !repairRegionDrawingOn(form));");
    expect(appJs).toContain('setDofFocus(form, [fx, fy]);');
  });

  it('repairOptionsFrom builds the repair options from the form and omits blank fields', () => {
    expect(appJs).toContain('function repairOptionsFrom(form, quiet)');
    expect(appJs).toContain("qsa('input[name=\"repair_part\"]:checked', form)");
    expect(appJs).toContain('if (parts.length < 2) options.parts = parts;');
    expect(appJs).toContain('if (regions.length > 0) options.regions = regions;');
    expect(appJs).toContain("seedsRaw.split(/[\\s,]+/)");
    expect(appJs).toContain("if (kind === 'repair') return repairOptionsFrom(form, quiet);");
  });

  it('redrawOptionsFrom reads keep regions from the per-form region-drawing state', () => {
    expect(appJs).toContain('function regionsFor(form)');
    expect(appJs).toContain('var regions = regionsFor(form);');
  });
});
