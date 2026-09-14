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

  it('finalizeOptionsFrom sends deliver_only:true and skips denoise/repair keys once it is checked', () => {
    expect(appJs).toContain('options.deliver_only = true;');
    expect(appJs).toContain("qs('input[name=\"deliver_only\"]', form)");
    const deliverOnlyBranch = appJs.split('if (deliverOnly) {')[1]?.split('return options;\n    }')[0] ?? '';
    expect(deliverOnlyBranch).not.toContain('options.denoise');
    expect(deliverOnlyBranch).not.toContain('options.repair');
  });

  it('disables/re-enables the denoise and repair controls when deliver_only is toggled', () => {
    expect(appJs).toContain('function syncFinalizeDeliverOnly(form)');
    expect(appJs).toContain('function initFinalizeDeliverOnly()');
    expect(appJs).toContain('syncFinalizeDeliverOnly(form);');
  });
});
