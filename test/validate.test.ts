import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from '../src/lib/standard-schema';
import { ValidationError, formatValidationIssues, parseOrThrow, validate } from '../src/lib/validate';

function schemaOf<T>(run: (value: unknown) => StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>>): StandardSchemaV1<unknown, T> {
  return { '~standard': { version: 1, vendor: 'test', validate: run } };
}

describe('validate / parseOrThrow', () => {
  it('returns the parsed value on success', () => {
    const schema = schemaOf<number>((v) => ({ value: Number(v) }));
    expect(validate(schema, '3')).toEqual({ ok: true, value: 3 });
    expect(parseOrThrow(schema, '4')).toBe(4);
  });

  it('normalizes path segments: plain keys, { key } objects, symbols and a missing path', () => {
    const sym = Symbol('s');
    const schema = schemaOf<never>(() => ({
      issues: [
        { message: 'a', path: ['items', 2, { key: 'name' }, { key: 3 }] },
        { message: 'b', path: [sym] },
        { message: 'c' },
      ],
    }));
    expect(validate(schema, {})).toEqual({
      ok: false,
      issues: [
        { path: ['items', 2, 'name', 3], message: 'a' },
        { path: ['Symbol(s)'], message: 'b' },
        { path: [], message: 'c' },
      ],
    });
  });

  it('parseOrThrow throws a ValidationError that carries the issues and the joined message', () => {
    const schema = schemaOf<never>(() => ({ issues: [{ message: 'bad', path: ['a', 0] }, { message: 'root' }] }));
    let thrown: unknown;
    try {
      parseOrThrow(schema, {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    const error = thrown as ValidationError;
    expect(error.issues).toEqual([
      { path: ['a', 0], message: 'bad' },
      { path: [], message: 'root' },
    ]);
    expect(error.message).toBe('a.0: bad; (root): root');
    expect(formatValidationIssues(error.issues)).toBe(error.message);
  });

  it('rejects a schema that validates asynchronously', () => {
    const schema = schemaOf<number>(async () => ({ value: 1 }));
    expect(() => validate(schema, 1)).toThrow('schema returned a Promise');
  });

  it('logs the original error when a zod refinement throws', async () => {
    const boom = new Error('boom');
    const schema = z.number().refine(() => {
      throw boom;
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => validate(schema, 1)).toThrow('schema returned a Promise');
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('schema validation threw', boom));
    logged.mockRestore();
  });
});
