// kind ごとの payload 封筒の検証と、Request 作成の kind 別の規則。payload の語彙そのものは schemas/request-payloads.ts にある。

import {
  deliverPayloadSchema,
  dofPayloadSchema,
  generatePayloadSchema,
  lensPayloadSchema,
  lightingPayloadSchema,
  maskedRedrawPayloadSchema,
  photoPayloadSchema,
  redrawPayloadSchema,
  repairPayloadSchema,
  stagePayloadSchema,
} from '../schemas/request-payloads';
import { FINALIZE_CREATION_MESSAGE, patchesFingerprintIssues } from './request-rules';
import { parseOrThrow, prefixIssues, validate, type ValidationIssue } from './validate';
import type { StandardSchemaV1 } from './standard-schema';
import type { RequestKind } from '../types';

export type PayloadKind = Exclude<RequestKind, 'finalize' | 'import'>;

function payloadSchemaFor(kind: PayloadKind): StandardSchemaV1 {
  switch (kind) {
    case 'redraw':
      return redrawPayloadSchema;
    case 'deliver':
      return deliverPayloadSchema;
    case 'dof':
      return dofPayloadSchema;
    case 'lens':
      return lensPayloadSchema;
    case 'photo':
      return photoPayloadSchema;
    case 'stage':
      return stagePayloadSchema;
    case 'lighting':
      return lightingPayloadSchema;
    case 'repair':
      return repairPayloadSchema;
    case 'masked_redraw':
      return maskedRedrawPayloadSchema;
    case 'generate':
      return generatePayloadSchema;
  }
}

/** REST (`POST /api/v1/requests`) と MCP `create_request` の両方が使う、kind に応じた payload 封筒の検証。path は payload からの相対。 */
export function payloadEnvelopeIssues(kind: PayloadKind, payload: unknown): ValidationIssue[] {
  const result = validate(payloadSchemaFor(kind), payload);
  return result.ok ? [] : result.issues;
}

/** payload 封筒の issue を、リクエスト本体の `payload` の下に付け替えたもの。 */
export function requestPayloadIssues(kind: PayloadKind, payload: unknown): ValidationIssue[] {
  return prefixIssues(['payload'], payloadEnvelopeIssues(kind, payload));
}

/** Canonicalizes to one stable vocabulary even when a caller uses aliases. Validation normally happens
 * at the REST/MCP boundary; parsing here also guards direct callers (e.g. request helpers). */
export function canonicalizeMaskedRedrawPayload(payload: unknown): Record<string, unknown> {
  const parsed = parseOrThrow(maskedRedrawPayloadSchema, payload);
  const { pad, feather, ...options } = parsed.options;
  if (options.mask_padding === undefined && pad !== undefined) options.mask_padding = pad;
  if (options.mask_feather === undefined && feather !== undefined) options.mask_feather = feather;
  return { generation_id: parsed.generation_id, options };
}

/** `POST /api/v1/requests` の本体に対する kind 別の規則。`resolutionKeys` は import だけが受ける解決済みの値のキー。 */
export function createRequestIssues(
  value: {
    kind: RequestKind;
    payload?: unknown;
    status?: string;
    run_id?: string;
    parameters?: unknown;
    patches?: unknown[] | null;
    pose_fingerprint?: string | null;
  },
  resolutionKeys: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value.kind === 'finalize') {
    return [{ message: FINALIZE_CREATION_MESSAGE, path: ['kind'] }];
  }
  if (value.kind === 'import') {
    if (value.status !== 'done') {
      issues.push({ message: "status must be 'done' for kind import", path: ['status'] });
    }
    if (!value.parameters) {
      issues.push({ message: 'parameters is required for kind import', path: ['parameters'] });
    }
    issues.push(...patchesFingerprintIssues(value));
    return issues;
  }
  if (value.status !== undefined) {
    issues.push({ message: 'status is only accepted for kind import', path: ['status'] });
  }
  if (value.run_id !== undefined) {
    issues.push({ message: 'run_id is only accepted for kind import', path: ['run_id'] });
  }
  for (const key of resolutionKeys) {
    if ((value as Record<string, unknown>)[key] !== undefined) {
      issues.push({ message: `${key} is only accepted for kind import`, path: [key] });
    }
  }
  if (value.payload === undefined) {
    issues.push({ message: 'payload is required', path: ['payload'] });
    return issues;
  }
  issues.push(...requestPayloadIssues(value.kind, value.payload));
  return issues;
}
