import { describe, expect, it } from 'vitest';
import { diffList, diffTokens, tokenize } from '../src/ui/diff';

describe('tokenize', () => {
  it('splits English text into word tokens with whitespace runs preserved', () => {
    expect(tokenize('a cat sitting')).toEqual(['a', ' ', 'cat', ' ', 'sitting']);
  });

  it('splits Japanese text one character at a time', () => {
    expect(tokenize('猫が座る')).toEqual(['猫', 'が', '座', 'る']);
  });

  it('splits mixed English/Japanese text, keeping word runs and whitespace intact', () => {
    expect(tokenize('cat 猫 sits')).toEqual(['cat', ' ', '猫', ' ', 'sits']);
  });
});

describe('diffTokens', () => {
  it('marks purely appended tokens as add', () => {
    const base = tokenize('a cat');
    const target = tokenize('a cat sleeping');
    const segs = diffTokens(base, target);
    expect(segs).toEqual([
      { text: 'a cat', type: 'same' },
      { text: ' sleeping', type: 'add' },
    ]);
  });

  it('marks purely removed tokens as del', () => {
    const base = tokenize('a cat sleeping');
    const target = tokenize('a cat');
    const segs = diffTokens(base, target);
    expect(segs).toEqual([
      { text: 'a cat', type: 'same' },
      { text: ' sleeping', type: 'del' },
    ]);
  });

  it('emits del before add for a replacement, and merges each side into one segment', () => {
    const base = tokenize('a cat sitting on a chair');
    const target = tokenize('a cat sleeping on a sofa');
    const segs = diffTokens(base, target);
    expect(segs[0]).toEqual({ text: 'a cat ', type: 'same' });
    const delIdx = segs.findIndex((s) => s.type === 'del');
    const addIdx = segs.findIndex((s) => s.type === 'add');
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(delIdx);
    expect(segs.find((s) => s.type === 'del')?.text).toContain('sitting');
    expect(segs.find((s) => s.type === 'add')?.text).toContain('sleeping');
  });

  it('returns a single same segment for fully identical input', () => {
    const base = tokenize('a girl standing');
    const target = tokenize('a girl standing');
    expect(diffTokens(base, target)).toEqual([{ text: 'a girl standing', type: 'same' }]);
  });

  it('merges adjacent same-type segments instead of leaving them as separate per-token entries', () => {
    const base = tokenize('the quick fox');
    const target = tokenize('the slow fox');
    const segs = diffTokens(base, target);
    // 'the ' / 'quick' / ' fox' -> same/del/same around a single add+del pair; same runs stay merged.
    const sameSegs = segs.filter((s) => s.type === 'same');
    expect(sameSegs.length).toBeLessThanOrEqual(2);
    for (const seg of sameSegs) {
      expect(seg.text.length).toBeGreaterThan(0);
    }
  });
});

describe('diffList', () => {
  it('marks an appended item as add, keeping items as separate segments', () => {
    const segs = diffList(['clean lines'], ['clean lines', 'good shading']);
    expect(segs).toEqual([
      { text: 'clean lines\n', type: 'same' },
      { text: 'good shading', type: 'add' },
    ]);
  });

  it('marks a removed item as del', () => {
    const segs = diffList(['clean lines', 'good shading'], ['clean lines']);
    expect(segs).toEqual([
      { text: 'clean lines\n', type: 'same' },
      { text: 'good shading', type: 'del' },
    ]);
  });
});
