import { z } from 'zod';
import type { StandardSchemaV1 } from '../lib/standard-schema';
import { poseOrComponentIssues } from '../lib/observation-rules';
import { addIssues } from './issues';

export const observationOutcomeSchema = z.enum(['accepted', 'rejected', 'inconclusive']);

/** pose/component の一方必須という不変条件 (docs/domain-model.md「Observation」) を REST と MCP tool 両方にかける。
 * MCP は observed_at を持たないため、refine 前のプレーン ZodObject を export し mcp.ts 側で .omit する。 */
export const createObservationObjectSchema = z.object({
  character: z.string().min(1),
  pose: z.string().min(1).optional(),
  component: z.string().min(1).optional(),
  parameter: z.string().min(1),
  value: z.string().min(1),
  outcome: observationOutcomeSchema,
  reason: z.string().min(1),
  seed: z.number().int().optional(),
  render_id: z.string().min(1).optional(),
  generation_ids: z.array(z.string().min(1)).optional(),
  recipe: z.string().min(1).optional(),
  observed_at: z.string().min(1).optional(),
  supersedes_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1),
});

export function requirePoseOrComponent(value: { pose?: string; component?: string }, ctx: z.RefinementCtx): void {
  addIssues(ctx, poseOrComponentIssues(value));
}

export const createObservationSchema = createObservationObjectSchema.superRefine(requirePoseOrComponent);

export type CreateObservationInput = StandardSchemaV1.InferOutput<typeof createObservationObjectSchema>;
