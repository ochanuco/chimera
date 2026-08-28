import { describe, expect, it } from 'vitest';
import { addOnlySegments, delMask, maskToSegments, tokenize } from '../src/ui/diff';

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

describe('addOnlySegments (non-base cell: own text only, with additions highlighted)', () => {
  it('marks purely appended tokens as add', () => {
    const base = tokenize('a cat');
    const target = tokenize('a cat sleeping');
    expect(addOnlySegments(base, target)).toEqual([
      { text: 'a cat', type: 'same' },
      { text: ' sleeping', type: 'add' },
    ]);
  });

  it('emits no del when target has fewer tokens than base', () => {
    const base = tokenize('a cat sleeping');
    const target = tokenize('a cat');
    const segs = addOnlySegments(base, target);
    expect(segs).toEqual([{ text: 'a cat', type: 'same' }]);
    expect(segs.some((s) => s.type === 'del')).toBe(false);
  });

  it('replacement: shows only the target word as add, never the base word', () => {
    const base = tokenize('a girl standing');
    const target = tokenize('a girl sitting');
    const segs = addOnlySegments(base, target);
    const joined = segs.map((s) => s.text).join('');
    expect(joined).toBe('a girl sitting');
    expect(joined).not.toContain('standing');
    expect(segs.some((s) => s.type === 'del')).toBe(false);
    expect(segs.find((s) => s.type === 'add')?.text).toBe('sitting');
  });

  it('returns a single same segment for fully identical input', () => {
    const base = tokenize('a girl standing');
    const target = tokenize('a girl standing');
    expect(addOnlySegments(base, target)).toEqual([{ text: 'a girl standing', type: 'same' }]);
  });

  it('merges adjacent add tokens into one segment', () => {
    const base = tokenize('the fox');
    const target = tokenize('the quick brown fox');
    const segs = addOnlySegments(base, target);
    const addSegs = segs.filter((s) => s.type === 'add');
    expect(addSegs.length).toBe(1);
    expect(addSegs[0]!.text.trim()).toBe('quick brown');
  });

  it('coarse fallback (product over threshold): whole value same or add, never del', () => {
    const base = Array.from({ length: 500 }, (_, i) => `b${i}`);
    const target = Array.from({ length: 500 }, (_, i) => `t${i}`);
    const segs = addOnlySegments(base, target);
    expect(segs).toEqual([{ text: target.join(''), type: 'add' }]);
  });

  it('coarse fallback: identical joined values collapse to same', () => {
    const shared = Array.from({ length: 500 }, (_, i) => `x${i}`);
    const segs = addOnlySegments(shared, [...shared]);
    expect(segs).toEqual([{ text: shared.join(''), type: 'same' }]);
  });
});

describe('delMask (base cell: which of its own tokens are missing from target)', () => {
  it('marks no tokens when target is a superset', () => {
    const base = tokenize('a cat');
    const target = tokenize('a cat sleeping');
    expect(delMask(base, target)).toEqual(base.map(() => false));
  });

  it('marks removed tokens as true', () => {
    const base = tokenize('a cat sleeping');
    const target = tokenize('a cat');
    const mask = delMask(base, target);
    const segs = maskToSegments(base, mask);
    expect(segs).toEqual([
      { text: 'a cat', type: 'same' },
      { text: ' sleeping', type: 'del' },
    ]);
  });

  it('replacement: marks the base-only word as true', () => {
    const base = tokenize('a girl standing');
    const target = tokenize('a girl sitting');
    const mask = delMask(base, target);
    const segs = maskToSegments(base, mask);
    expect(segs.find((s) => s.type === 'del')?.text).toBe('standing');
  });

  it('returns all-false for identical input', () => {
    const base = tokenize('a girl standing');
    expect(delMask(base, tokenize('a girl standing'))).toEqual(base.map(() => false));
  });

  it('coarse fallback (product over threshold): all true when values differ, all false when identical', () => {
    const base = Array.from({ length: 500 }, (_, i) => `b${i}`);
    const target = Array.from({ length: 500 }, (_, i) => `t${i}`);
    expect(delMask(base, target)).toEqual(base.map(() => true));
    expect(delMask(base, [...base])).toEqual(base.map(() => false));
  });
});

describe('maskToSegments', () => {
  it('merges consecutive true/false runs into del/same segments', () => {
    const tokens = ['a', ' ', 'girl', ' ', 'standing'];
    const mask = [false, false, false, false, true];
    expect(maskToSegments(tokens, mask)).toEqual([
      { text: 'a girl ', type: 'same' },
      { text: 'standing', type: 'del' },
    ]);
  });

  it('supports the OR of several masks (multiple targets losing different parts of the base)', () => {
    const base = tokenize('a cat sitting on a chair');
    const maskA = delMask(base, tokenize('a cat sitting on a sofa')); // loses "chair"
    const maskB = delMask(base, tokenize('a cat sleeping on a chair')); // loses "sitting"
    const orMask = base.map((_, i) => maskA[i]! || maskB[i]!);
    const segs = maskToSegments(base, orMask);
    const delText = segs
      .filter((s) => s.type === 'del')
      .map((s) => s.text)
      .join('');
    expect(delText).toContain('sitting');
    expect(delText).toContain('chair');
  });

  it('returns a single same segment when the mask is all false', () => {
    const tokens = tokenize('a girl standing');
    expect(maskToSegments(tokens, tokens.map(() => false))).toEqual([{ text: 'a girl standing', type: 'same' }]);
  });
});
