// 検証ライブラリへの依存をここで止める。スキーマは Standard Schema として受け、呼び出し側は zod の API を使わない。

import type { StandardSchemaV1 } from './standard-schema';

export type ValidationIssue = { path: (string | number)[]; message: string };

export type ValidationResult<S extends StandardSchemaV1> =
  | { ok: true; value: StandardSchemaV1.InferOutput<S> }
  | { ok: false; issues: ValidationIssue[] };

/** 入れ子の値に対する検証結果を、親の path の下に付け替える。 */
export function prefixIssues(prefix: (string | number)[], issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ message: issue.message, path: [...prefix, ...issue.path] }));
}

/** 400 の本文にそのまま載せる形: `path.to.field: message; ...` (path が空なら `(root)`)。 */
export function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export class ValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = 'ValidationError';
  }
}

function toPathElement(segment: PropertyKey | StandardSchemaV1.PathSegment): string | number {
  const key = typeof segment === 'object' ? segment.key : segment;
  return typeof key === 'symbol' ? key.toString() : key;
}

export function validate<S extends StandardSchemaV1>(schema: S, input: unknown): ValidationResult<S> {
  const result = schema['~standard'].validate(input);
  if (result instanceof Promise) throw new Error('async schemas are not supported');
  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((issue) => ({ path: (issue.path ?? []).map(toPathElement), message: issue.message })),
    };
  }
  return { ok: true, value: result.value as StandardSchemaV1.InferOutput<S> };
}

export function parseOrThrow<S extends StandardSchemaV1>(schema: S, input: unknown): StandardSchemaV1.InferOutput<S> {
  const result = validate(schema, input);
  if (!result.ok) throw new ValidationError(result.issues);
  return result.value;
}
