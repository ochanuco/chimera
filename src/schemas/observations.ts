import { z } from 'zod';

export const observationOutcomeSchema = z.enum(['accepted', 'rejected', 'inconclusive']);

/** sync の body はファイル単位 (docs/api.md「Observation」)。不正レコードは 400 ではなく skipped で返すため、
 * ここでは配列の形だけ検証し各レコードの妥当性判定は lib/observations.ts (normalizeRecord) に任せる。 */
export const observationSyncRequestSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      records: z.array(
        z.object({
          line: z.number().int().positive(),
          // record 自身が持たないときだけ使うフォールバック。パスからは推測しない (docs/api.md「Observation」)。id の計算には入らない。
          character: z.string().min(1).optional(),
          component: z.string().min(1).optional(),
          record: z.unknown(),
        }),
      ),
    }),
  ),
});

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
  if (!value.pose && !value.component) {
    ctx.addIssue({ code: 'custom', message: 'pose か component の少なくとも一方が必要です', path: ['pose'] });
  }
}

export const createObservationSchema = createObservationObjectSchema.superRefine(requirePoseOrComponent);

export type CreateObservationInput = z.infer<typeof createObservationObjectSchema>;
