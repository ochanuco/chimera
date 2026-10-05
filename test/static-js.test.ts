import { describe, expect, it } from 'vitest';
import { appJs } from '../src/ui/static';

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

  it('finalizeOptionsFrom sends deliver_only:true, keeps repair/repair_regions shared but skips denoise/repair_lora, and only sends repair_seeds once it is checked', () => {
    expect(appJs).toContain('options.deliver_only = true;');
    expect(appJs).toContain("qs('input[name=\"deliver_only\"]', form)");
    // repair / repair_regions / repair_pad are assigned before the deliverOnly branch, so both
    // modes get them; only denoise/repair_lora (redraw-only) and repair_seeds (deliver_only-only) differ.
    expect(appJs).toContain('options.repair = repair;');
    expect(appJs).toContain('options.repair_regions = regions;');
    const deliverOnlyBranch = appJs.split('if (deliverOnly) {')[1]?.split('return options;\n    }')[0] ?? '';
    expect(deliverOnlyBranch).not.toContain('options.denoise');
    expect(deliverOnlyBranch).not.toContain('options.repair_lora');
    expect(deliverOnlyBranch).toContain('options.repair_seeds');
  });

  it('disables/re-enables the denoise and repair controls when deliver_only is toggled', () => {
    expect(appJs).toContain('function syncFinalizeDeliverOnly(form)');
    expect(appJs).toContain('function initFinalizeDeliverOnly()');
    expect(appJs).toContain('syncFinalizeDeliverOnly(form);');
  });

  it('finalizeOptionsFrom gates every repair* key on a checked part or a drawn region, not on deliver_only', () => {
    // repairActive (repair non-empty or regions non-empty) gates options.repair/repair_regions.
    expect(appJs).toContain('var repairActive = repair.length > 0 || regions.length > 0;');
    expect(appJs).toContain('if (repairActive) {\n      options.repair = repair;\n      if (regions.length > 0) options.repair_regions = regions;\n    }');
    expect(appJs).toContain('if (regions.length > 0) repair = [];');
    // repair_pad stays gated on a checked part specifically (not merely a drawn region), matching
    // the single-part repair endpoint's existing contract.
    expect(appJs).toContain("if (repair.length > 0 && repairPadRaw !== '') options.repair_pad = Number(repairPadRaw);");
  });

  it('finalizeOptionsFrom turns the hires select into options.hires / hires_denoise before the deliver_only branch, and omits both when off', () => {
    expect(appJs).toContain("qs('select[name=\"hires\"]', form)");
    expect(appJs).toContain("hiresSelect.value !== 'off'");
    expect(appJs).toContain('options.hires = Number(hiresParts[0]);');
    expect(appJs).toContain('options.hires_denoise = Number(hiresParts[1]);');
    expect(appJs.indexOf('options.hires = Number')).toBeLessThan(appJs.indexOf('if (deliverOnly) {'));
  });

  it('finalizeOptionsFrom refuses hires outside deliver_only or alongside repair, before queueing', () => {
    expect(appJs).toContain('if (options.hires !== undefined && (!deliverOnly || repairActive)) {');
    expect(appJs.indexOf('options.hires !== undefined && (!deliverOnly')).toBeLessThan(appJs.indexOf('if (deliverOnly) {'));
  });

  it('restores the hires select from a profile\'s hires / hires_denoise', () => {
    expect(appJs).toContain('function applyHiresToForm(form, options)');
    expect(appJs).toContain("options.hires_denoise === undefined ? 0.45 : options.hires_denoise");
  });

  it('finalizeOptionsFrom builds options.dof from the placed focus and the slider stop, and refuses dof without a focus', () => {
    expect(appJs).toContain('options.dof = { focus: [dofFocus[0], dofFocus[1]], f_number: dofFNumber(form) };');
    expect(appJs).toContain('return slider && stops.length > 0 ? stops[Number(slider.value)] : undefined;');
    expect(appJs).toContain("if (!quiet) alert('ボケを使うときは画像をクリックしてピント位置を置いてください');");
    expect(appJs.indexOf('options.dof = {')).toBeLessThan(appJs.indexOf('if (deliverOnly) {'));
  });

  it('finalizeOptionsFrom refuses dof alongside repair, before queueing', () => {
    expect(appJs).toContain('if (options.dof !== undefined && repairActive) {');
    expect(appJs.indexOf('options.dof !== undefined && repairActive')).toBeLessThan(appJs.indexOf('options.repair = repair;'));
  });

  it('renders dof in the preview as f-number and focus, and restores it from a profile', () => {
    expect(appJs).toContain("parts.push('dof f/' + value.f_number + ' @ ' + value.focus[0] + ', ' + value.focus[1] + (value.scope === 'all' ? ' · 背景も' : '') + (value.viewfinder === 'on' ? ' · ファインダー' : value.viewfinder === 'both' ? ' · ファインダー ON/OFF 2枚' : ''));");
    expect(appJs).toContain('function applyDofToForm(form, options)');
    expect(appJs).toContain("key === 'hires_denoise' || key === 'dof'");
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
    expect(appJs).toMatch(/syncFinalizeBackdropColor\(form\);\n\s+applyDofMode\(form\);/);
  });

  it('sends dof.viewfinder only when the select is not off, disables it while dof is off, and restores it from a profile', () => {
    expect(appJs).toContain("if (dofViewfinder && dofViewfinder.value !== 'off') options.dof.viewfinder = dofViewfinder.value;");
    expect(appJs).toContain('if (viewfinderSelect) viewfinderSelect.disabled = !on;');
    expect(appJs).toContain("if (viewfinderSelect) viewfinderSelect.value = dof.viewfinder === 'on' || dof.viewfinder === 'both' ? dof.viewfinder : 'off';");
    expect(appJs).toContain("(value.viewfinder === 'on' ? ' · ファインダー' : value.viewfinder === 'both' ? ' · ファインダー ON/OFF 2枚' : '')");
  });

  it('places the dof focus through the repair-region overlay only while region drawing is off', () => {
    expect(appJs).toContain("state.overlay.classList.toggle('dof-focus-on', on && !repairRegionDrawingOn(form));");
    expect(appJs).toContain('setDofFocus(form, [fx, fy]);');
  });

  it('finalizeOptionsFrom reads repair regions from the per-form region-drawing state', () => {
    expect(appJs).toContain('function regionsFor(form)');
    expect(appJs).toContain('var regions = regionsFor(form);');
  });
});
