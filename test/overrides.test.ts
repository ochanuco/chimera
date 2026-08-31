import { describe, expect, it } from 'vitest';
import {
  diffOverrides,
  formatOverrideValue,
  parseJsonObject,
  parseJsonObjectOrNull,
} from '../src/lib/overrides';

describe('parseJsonObject', () => {
  it('returns {} for null/undefined', () => {
    expect(parseJsonObject(null)).toEqual({});
    expect(parseJsonObject(undefined)).toEqual({});
  });

  it('returns {} for invalid JSON', () => {
    expect(parseJsonObject('not json')).toEqual({});
  });

  it('returns {} for JSON that is not a plain object', () => {
    expect(parseJsonObject('[1,2]')).toEqual({});
    expect(parseJsonObject('"a string"')).toEqual({});
    expect(parseJsonObject('42')).toEqual({});
  });

  it('parses a valid object', () => {
    expect(parseJsonObject('{"a":1,"b":{"c":2}}')).toEqual({ a: 1, b: { c: 2 } });
  });
});

describe('parseJsonObjectOrNull', () => {
  it('returns null for null/undefined', () => {
    expect(parseJsonObjectOrNull(null)).toBeNull();
    expect(parseJsonObjectOrNull(undefined)).toBeNull();
  });

  it('returns {} for an empty object string', () => {
    expect(parseJsonObjectOrNull('{}')).toEqual({});
  });

  it('parses a valid object', () => {
    expect(parseJsonObjectOrNull('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns {} for invalid JSON (still distinct from null)', () => {
    expect(parseJsonObjectOrNull('not json')).toEqual({});
  });
});

describe('formatOverrideValue', () => {
  it('passes strings through', () => {
    expect(formatOverrideValue('hello')).toBe('hello');
  });

  it('stringifies numbers and booleans', () => {
    expect(formatOverrideValue(0.72)).toBe('0.72');
    expect(formatOverrideValue(true)).toBe('true');
    expect(formatOverrideValue(false)).toBe('false');
  });

  it('renders null and undefined as the literal "null"', () => {
    expect(formatOverrideValue(null)).toBe('null');
    expect(formatOverrideValue(undefined)).toBe('null');
  });

  it('joins an array of primitives with ", "', () => {
    expect(formatOverrideValue(['a', 'b', 'c'])).toBe('a, b, c');
    expect(formatOverrideValue([1, 2, 3])).toBe('1, 2, 3');
  });

  it('JSON.stringifies anything else, including arrays of objects', () => {
    expect(formatOverrideValue({ a: 1 })).toBe('{"a":1}');
    expect(formatOverrideValue([{ a: 1 }])).toBe(JSON.stringify([{ a: 1 }]));
  });
});

describe('diffOverrides', () => {
  it('flattens nested objects into dotted leaf paths', () => {
    const base = {};
    const next = { prompt: { positive_append: ['a'] }, controlnet: { weight: 0.72 } };
    const entries = diffOverrides(base, next);
    expect(entries.map((e) => e.path)).toEqual(['controlnet.weight', 'prompt.positive_append']);
  });

  it('treats arrays as leaves, not recursing into them', () => {
    const base = { tags: ['a'] };
    const next = { tags: ['a', 'b'] };
    const entries = diffOverrides(base, next);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'tags', kind: 'changed' });
  });

  it('treats an empty object as a leaf', () => {
    const base = {};
    const next = { extra: {} };
    const entries = diffOverrides(base, next);
    expect(entries).toEqual([{ path: 'extra', kind: 'added', before: null, after: '{}' }]);
  });

  it('sorts entries by path', () => {
    const base = {};
    const next = { z: 1, a: 2, m: 3 };
    const entries = diffOverrides(base, next);
    expect(entries.map((e) => e.path)).toEqual(['a', 'm', 'z']);
  });

  it('omits leaves that are equal on both sides', () => {
    const base = { a: 1, b: { c: 2 } };
    const next = { a: 1, b: { c: 2 } };
    expect(diffOverrides(base, next)).toEqual([]);
  });

  it('marks a leaf only in next as added, with before: null', () => {
    const entries = diffOverrides({}, { foo: 'bar' });
    expect(entries).toEqual([{ path: 'foo', kind: 'added', before: null, after: 'bar' }]);
  });

  it('marks a leaf only in base as removed, with after: null', () => {
    const entries = diffOverrides({ foo: 'bar' }, {});
    expect(entries).toEqual([{ path: 'foo', kind: 'removed', before: 'bar', after: null }]);
  });

  it('marks a leaf present in both but different as changed', () => {
    const entries = diffOverrides({ weight: 0.5 }, { weight: 0.72 });
    expect(entries).toEqual([{ path: 'weight', kind: 'changed', before: '0.5', after: '0.72' }]);
  });

  it('handles a realistic nested override diff end to end', () => {
    const base = { prompt: { positive_append: ['light purple thighhigh socks'] }, controlnet: { weight: 0.5 } };
    const next = {
      prompt: { positive_append: ['distinct sock cuff'] },
      controlnet: { weight: 0.5 },
      lora: { strength: 0.8 },
    };
    const entries = diffOverrides(base, next);
    expect(entries).toEqual([
      { path: 'lora.strength', kind: 'added', before: null, after: '0.8' },
      {
        path: 'prompt.positive_append',
        kind: 'changed',
        before: 'light purple thighhigh socks',
        after: 'distinct sock cuff',
      },
    ]);
  });
});
