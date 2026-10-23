// kind ごとの payload 封筒の検証と、Request 作成の kind 別の規則。payload の語彙そのものは schemas/request-payloads.ts にある。

import {
  deliverPayloadSchema,
  dofPayloadSchema,
  generatePayloadSchema,
  lensPayloadSchema,
  lightingPayloadSchema,
  photoPayloadSchema,
  redrawPayloadSchema,
  referencePayloadSchema,
  saturationPayloadSchema,
  stagePayloadSchema,
} from '../schemas/request-payloads';
import { FINALIZE_CREATION_MESSAGE, PARTIAL_FIX_CREATION_MESSAGE, patchesFingerprintIssues } from './request-rules';
import { prefixIssues, validate, type ValidationIssue } from './validate';
import type { StandardSchemaV1 } from './standard-schema';
import type { RequestKind } from '../types';

export type PayloadKind = Exclude<RequestKind, 'finalize' | 'repair' | 'masked_redraw' | 'import'>;

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
    case 'saturation':
      return saturationPayloadSchema;
    case 'reference':
      return referencePayloadSchema;
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
  if (value.kind === 'repair' || value.kind === 'masked_redraw') {
    return [{ message: PARTIAL_FIX_CREATION_MESSAGE, path: ['kind'] }];
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
