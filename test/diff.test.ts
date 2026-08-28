import { describe, expect, it } from 'vitest';
import { consensusSegments, matchMask, tokenize } from '../src/ui/diff';

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

describe('matchMask', () => {
  it('marks every token true when fully matched (subset of a superset)', () => {
    const tokens = tokenize('a cat');
    const other = tokenize('a cat sleeping');
    expect(matchMask(tokens, other)).toEqual(tokens.map(() => true));
  });

  it('marks every token false when nothing matches', () => {
    const tokens = tokenize('xyz');
    const other = tokenize('abc');
    expect(matchMask(tokens, other)).toEqual([false]);
  });

  it('marks only the matched tokens true on partial overlap (replacement)', () => {
    const tokens = tokenize('a girl standing');
    const other = tokenize('a girl sitting');
    const mask = matchMask(tokens, other);
    // tokens: ['a', ' ', 'girl', ' ', 'standing']
    expect(mask).toEqual([true, true, true, true, false]);
  });

  it('coarse fallback (product over threshold): all true when joined values are equal', () => {
    const shared = Array.from({ length: 500 }, (_, i) => `x${i}`);
    expect(matchMask(shared, [...shared])).toEqual(shared.map(() => true));
  });

  it('coarse fallback (product over threshold): all false when joined values differ', () => {
    const tokens = Array.from({ length: 500 }, (_, i) => `b${i}`);
    const other = Array.from({ length: 500 }, (_, i) => `t${i}`);
    expect(matchMask(tokens, other)).toEqual(tokens.map(() => false));
  });
});

describe('consensusSegments', () => {
  it('classifies same/partial/uniq by match count against othersCount', () => {
    const tokens = ['common', 'shared', 'mine'];
    // othersCount = 2: 'common' matches both others (2), 'shared' matches one (1), 'mine' matches none (0)
    const segs = consensusSegments(tokens, [2, 1, 0], 2);
    expect(segs).toEqual([
      { text: 'common', type: 'same' },
      { text: 'shared', type: 'partial' },
      { text: 'mine', type: 'uniq' },
    ]);
  });

  it('merges adjacent segments of the same resulting type', () => {
    const tokens = ['a', 'b', 'c', 'd'];
    // a,b both fully matched (same); c,d both unmatched (uniq)
    const segs = consensusSegments(tokens, [2, 2, 0, 0], 2);
    expect(segs).toEqual([
      { text: 'ab', type: 'same' },
      { text: 'cd', type: 'uniq' },
    ]);
  });

  it('never produces partial when othersCount is 1 (degenerates to same/uniq)', () => {
    const tokens = ['same', 'diff'];
    const segs = consensusSegments(tokens, [1, 0], 1);
    expect(segs).toEqual([
      { text: 'same', type: 'same' },
      { text: 'diff', type: 'uniq' },
    ]);
    expect(segs.some((s) => s.type === 'partial')).toBe(false);
  });

  it('returns a single same segment when every token matches every other lane', () => {
    const tokens = tokenize('a girl standing');
    const segs = consensusSegments(tokens, tokens.map(() => 2), 2);
    expect(segs).toEqual([{ text: 'a girl standing', type: 'same' }]);
  });
});
