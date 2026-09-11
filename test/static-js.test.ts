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
});
