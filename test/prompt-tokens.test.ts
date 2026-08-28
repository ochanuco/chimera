import { describe, expect, it } from 'vitest';
import { tokenizePrompt, diffTokens } from '../src/lib/prompt-tokens';

describe('tokenizePrompt', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    const tokens = tokenizePrompt('1girl,  masterpiece , best quality');
    expect(tokens).toEqual([
      { text: '1girl', weight: 1, kind: 'tag' },
      { text: 'masterpiece', weight: 1, kind: 'tag' },
      { text: 'best quality', weight: 1, kind: 'tag' },
    ]);
  });

  it('drops empty segments from stray commas', () => {
    const tokens = tokenizePrompt('a,, b,');
    expect(tokens).toEqual([
      { text: 'a', weight: 1, kind: 'tag' },
      { text: 'b', weight: 1, kind: 'tag' },
    ]);
  });

  it('parses a standalone BREAK as kind break', () => {
    const tokens = tokenizePrompt('a, BREAK, b');
    expect(tokens[1]).toEqual({ text: 'BREAK', weight: 1, kind: 'break' });
  });

  it('parses <lora:name:weight> as kind lora', () => {
    const tokens = tokenizePrompt('<lora:add_detail:0.8>');
    expect(tokens).toEqual([{ text: 'lora:add_detail', weight: 0.8, kind: 'lora' }]);
  });

  it('defaults lora weight to 1 when omitted', () => {
    const tokens = tokenizePrompt('<lora:add_detail>');
    expect(tokens).toEqual([{ text: 'lora:add_detail', weight: 1, kind: 'lora' }]);
  });

  it('parses explicit weight syntax (foo:1.3)', () => {
    const tokens = tokenizePrompt('(masterpiece:1.3)');
    expect(tokens).toEqual([{ text: 'masterpiece', weight: 1.3, kind: 'tag' }]);
  });

  it('derives weight from nested parens depth as 1.1^n', () => {
    expect(tokenizePrompt('(foo)')).toEqual([{ text: 'foo', weight: 1.1, kind: 'tag' }]);
    expect(tokenizePrompt('((foo))')).toEqual([{ text: 'foo', weight: 1.21, kind: 'tag' }]);
  });

  it('derives weight from nested brackets depth as 0.9^n', () => {
    expect(tokenizePrompt('[foo]')).toEqual([{ text: 'foo', weight: 0.9, kind: 'tag' }]);
    expect(tokenizePrompt('[[foo]]')).toEqual([{ text: 'foo', weight: 0.81, kind: 'tag' }]);
  });

  it('prefers the explicit weight over depth when both are present', () => {
    const tokens = tokenizePrompt('((foo:1.2))');
    expect(tokens).toEqual([{ text: 'foo', weight: 1.2, kind: 'tag' }]);
  });

  it('never throws on malformed bracket syntax and falls back to weight 1', () => {
    expect(() => tokenizePrompt('(unclosed')).not.toThrow();
    const tokens = tokenizePrompt('(unclosed');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.weight).toBe(1);
  });

  it('returns an empty array for null-ish/empty input', () => {
    expect(tokenizePrompt('')).toEqual([]);
  });
});

describe('diffTokens', () => {
  it('marks tokens present only in current as added', () => {
    const current = tokenizePrompt('a, b');
    const parent = tokenizePrompt('a');
    const { tokens, removed } = diffTokens(current, parent);
    expect(tokens.find((t) => t.text === 'b')?.diff).toBe('added');
    expect(tokens.find((t) => t.text === 'a')?.diff).toBeUndefined();
    expect(removed).toEqual([]);
  });

  it('marks tokens present only in parent as removed', () => {
    const current = tokenizePrompt('a');
    const parent = tokenizePrompt('a, b');
    const { tokens, removed } = diffTokens(current, parent);
    expect(tokens).toEqual([{ text: 'a', weight: 1, kind: 'tag' }]);
    expect(removed).toEqual([{ text: 'b', weight: 1, kind: 'tag' }]);
  });

  it('marks tokens with a changed weight as weight diff, carrying parentWeight', () => {
    const current = tokenizePrompt('(a:1.3)');
    const parent = tokenizePrompt('(a:0.8)');
    const { tokens } = diffTokens(current, parent);
    expect(tokens[0]).toEqual({ text: 'a', weight: 1.3, kind: 'tag', diff: 'weight', parentWeight: 0.8 });
  });

  it('leaves unchanged tokens without a diff marker', () => {
    const current = tokenizePrompt('a, b');
    const parent = tokenizePrompt('a, b');
    const { tokens, removed } = diffTokens(current, parent);
    expect(tokens.every((t) => t.diff === undefined)).toBe(true);
    expect(removed).toEqual([]);
  });
});
