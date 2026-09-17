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
    // modes get them; only denoise and repair_lora (redraw-only) and repair_seeds (deliver_only-only)
    // differ by mode.
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
    // repairActive (the deliver_only+feet+regions case: repair non-empty or regions non-empty)
    // gates options.repair/options.repair_regions; nothing checked and no regions sends neither.
    expect(appJs).toContain('var repairActive = repair.length > 0 || regions.length > 0;');
    expect(appJs).toContain('if (repairActive) {\n      options.repair = repair;\n      if (regions.length > 0) options.repair_regions = regions;\n    }');
    expect(appJs).toContain('if (regions.length > 0) repair = [];');
    // repair_pad stays gated on a checked part specifically (not merely a drawn region), matching
    // the single-part repair endpoint's existing contract.
    expect(appJs).toContain("if (repair.length > 0 && repairPadRaw !== '') options.repair_pad = Number(repairPadRaw);");
  });

  it('finalizeOptionsFrom reads repair regions from the per-form region-drawing state', () => {
    expect(appJs).toContain('function regionsFor(form)');
    expect(appJs).toContain('var regions = regionsFor(form);');
  });
});
