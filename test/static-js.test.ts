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
    expect(appJs).toContain("return formKind(form) === 'redraw' ? redrawOptionsFrom(form) : deliverOptionsFrom(form, quiet);");
    expect(appJs).toContain('const kind = formKind(form);');
    expect(appJs).toContain('postOptionRequest(kind, shortId, options, profile)');
    expect(appJs).toContain("idempotency_key: 'gui:' + kind + ':' + generationShortId + ':' + crypto.randomUUID(),");
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

  it('deliverOptionsFrom builds options.dof from the placed focus and the slider stop, and refuses dof without a focus', () => {
    expect(appJs).toContain('options.dof = { focus: [dofFocus[0], dofFocus[1]], f_number: dofFNumber(form) };');
    expect(appJs).toContain('return slider && stops.length > 0 ? stops[Number(slider.value)] : undefined;');
    expect(appJs).toContain("if (!quiet) alert('ボケを使うときは画像をクリックしてピント位置を置いてください');");
  });

  it('renders dof in the preview as f-number and focus, and restores it from a profile', () => {
    expect(appJs).toContain("parts.push('dof f/' + value.f_number + ' @ ' + value.focus[0] + ', ' + value.focus[1] + (value.scope === 'all' ? ' · 背景も' : '') + (value.viewfinder === 'on' ? ' · ファインダー' : value.viewfinder === 'both' ? ' · ファインダー ON/OFF 2枚' : ''));");
    expect(appJs).toContain('function applyDofToForm(form, options)');
    expect(appJs).toContain("if (key === 'dof' || key === 'light' || key === 'stroke_light') return;");
  });

  it('sends dof.scope only when the scope checkbox exists, and refuses scope all with transparent delivery', () => {
    expect(appJs).toContain("if (dofScopeCheck) options.dof.scope = !dofScopeCheck.disabled && dofScopeCheck.checked ? 'all' : 'figure';");
    expect(appJs).toContain("if (options.dof.scope === 'all' && backdrop === null) {");
    expect(appJs).toContain("alert('背景もぼかすは透過納品とは併用できません');");
    expect(appJs).toContain("(value.scope === 'all' ? ' · 背景も' : '')");
  });

  it('disables the dof scope checkbox while dof is off or delivery is transparent, and restores it from a profile', () => {
    expect(appJs).toContain("scopeBox.disabled = !on || (!!backdropRadio && backdropRadio.value === 'transparent');");
    expect(appJs).toContain("if (scopeBox) scopeBox.checked = dof.scope === 'all';");
    expect(appJs).toMatch(/syncBackdropColor\(form\);\n\s+applyDofMode\(form\);/);
  });

  it('sends dof.viewfinder only when the select is not off, disables it while dof is off, and restores it from a profile', () => {
    expect(appJs).toContain("if (dofViewfinder && dofViewfinder.value !== 'off') options.dof.viewfinder = dofViewfinder.value;");
    expect(appJs).toContain('if (viewfinderSelect) viewfinderSelect.disabled = !on;');
    expect(appJs).toContain("if (viewfinderSelect) viewfinderSelect.value = dof.viewfinder === 'on' || dof.viewfinder === 'both' ? dof.viewfinder : 'off';");
    expect(appJs).toContain("(value.viewfinder === 'on' ? ' · ファインダー' : value.viewfinder === 'both' ? ' · ファインダー ON/OFF 2枚' : '')");
  });

  it('maps 紫縁 and 光の向き to stroke_light: 既定 omits it, 立体 sends the direction, 均等 / 無し send even / none', () => {
    expect(appJs).toContain("var strokeStyle = qs('select[name=\"stroke_style\"]', form).value;");
    expect(appJs).toContain("} else if (strokeStyle === 'dir') {\n      options.stroke_light = lightFrom;");
    expect(appJs).toContain("} else if (strokeStyle !== 'auto') {\n      options.stroke_light = strokeStyle;");
  });

  it('sends light with the shared direction, leaves 立体 to the light, and disables 光の向き only with no scene and a non-立体 rim', () => {
    expect(appJs).toContain('options.light = { scene: lightScene.value, from: lightFrom };');
    expect(appJs).toContain("if (strokeStyle === 'even' || strokeStyle === 'none') options.stroke_light = strokeStyle;");
    expect(appJs).toContain("fromSelect.disabled = (!scene || scene.value === '') && !!style && style.value !== 'dir';");
    expect(appJs).toContain("select.name !== 'light_scene' && select.name !== 'stroke_style'");
  });

  it('sends backdrop null for the transparent choice and checks the colour format', () => {
    expect(appJs).toContain("var backdrop = backdropMode === 'transparent' ? null : backdropMode;");
    expect(appJs).toContain("alert('backdrop color must be #RRGGBB')");
  });

  it('restores stroke_light and light from a profile: direction -> 立体 + 光の向き, even/null -> 均等, none -> 無し, absent -> 既定', () => {
    expect(appJs).toContain('applyStrokeToForm(form, options);');
    expect(appJs).toContain('applyLightToForm(form, options);');
    expect(appJs).toContain("} else if (stroke === null) {\n      style.value = 'even';");
    expect(appJs).toContain("style.value = 'dir';\n      fromSelect.value = stroke;");
    expect(appJs).toContain("} else if (stroke === undefined) {\n      style.value = 'auto';");
    expect(appJs).toContain("parts.push('光源 '");
    expect(appJs).not.toContain('applyHiresToForm');
  });

  it('describes 光源 / 光の向き / 紫縁 in the deliver send preview with the form wording instead of stroke_light', () => {
    expect(appJs).toContain("parts.push('光の向き ' + fromLabel);");
    expect(appJs).toContain("'（' + fromLabel + '）'");
    expect(appJs).toContain("parts.push('紫縁 ' + styleSelect.options[styleSelect.selectedIndex].textContent.trim());");
    expect(appJs).toContain("if (deliver && (key === 'backdrop' || key === 'light' || key === 'stroke_light')) return;");
    expect(appJs).toContain("var deliver = formKind(form) === 'deliver';");
  });

  it('previews keep_regions as a count and prefixes the preview with the profile for a deliver form', () => {
    expect(appJs).toContain("parts.push('keep_regions=' + value.length + '箇所');");
    expect(appJs).toContain("if (profile) parts.push('profile ' + profile.name");
    expect(appJs).toContain("preview.textContent = '送信内容: ' + parts.join(' · ');");
  });

  it('applies a profile only through the profile buttons of a form (deliver forms render them)', () => {
    expect(appJs).toContain("ev.target.closest('.profile-group .dial-btn')");
    expect(appJs).toContain('applyProfileOptionsToForm(form, options);');
  });

  it('labels request kinds 描き直し / 納品 / repair / masked redraw / finalize without defaulting new kinds to finalize', () => {
    expect(appJs).toContain("var labels = { redraw: '描き直し', deliver: '納品', repair: 'repair', masked_redraw: 'masked redraw', finalize: 'finalize' };");
    expect(appJs).toContain("return labels[kind] || kind || '';");
    expect(appJs).toContain('requestKindLabel(kind) + \' · \'');
    expect(appJs).toContain('kind.textContent = requestKindLabel(request.kind);');
  });

  it('keeps each form\'s region overlay separate, so redraw keep-regions and deliver focus placement coexist', () => {
    expect(appJs).toContain("overlay.setAttribute('data-owner', owner);");
    expect(appJs).toContain("qs('.repair-region-overlay[data-owner=\"' + owner + '\"]', parent)");
  });

  it('draws a clipped, click-through dof guide circle sized by guide_radius_per_f * F * long side and updated with the focus, F and ボケ toggle', () => {
    expect(appJs).toContain('function updateDofGuide(form)');
    expect(appJs).toContain("slider.getAttribute('data-dof-guide-radius')");
    expect(appJs).toContain('var d = 2 * k * f * Math.max(w, h);');
    expect(appJs).toContain("var show = !!box && box.checked && !!focus && k > 0 && f !== undefined;");
    expect(appJs).toContain("guideClip.className = 'dof-guide-clip';");
    expect(appJs).toContain('var resync = function () { syncRepairRegionOverlayGeometry(state); updateDofGuide(form); };');
    expect(styleCss).toMatch(/\.dof-guide-clip \{[^}]*overflow: hidden; pointer-events: none;/);
    expect(styleCss).toMatch(/\.dof-guide-circle \{[^}]*pointer-events: none;/);
  });

  it('places the dof focus through the repair-region overlay only while region drawing is off', () => {
    expect(appJs).toContain("state.overlay.classList.toggle('dof-focus-on', on && !repairRegionDrawingOn(form));");
    expect(appJs).toContain('setDofFocus(form, [fx, fy]);');
  });

  it('redrawOptionsFrom reads keep regions from the per-form region-drawing state', () => {
    expect(appJs).toContain('function regionsFor(form)');
    expect(appJs).toContain('var regions = regionsFor(form);');
  });
});
