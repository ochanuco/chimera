// MCP tool の inputSchema。SDK が引数の検証と tools/list の JSON Schema 生成に使うので、宣言の形はクライアントから見える契約になる。
// REST と同じ語彙は schemas/request-payloads.ts など既存の宣言を借り、ここに二重定義しない。

import { z } from 'zod';
import { createExperimentRunSchema, experimentStatusSchema, jsonObject, patchesSchema } from './experiments';
import { creatableRequestKindSchema, requestKindFilterSchema, requestStatusSchema } from './requests';
import {
  redrawOptionsSchema,
  deliverOptionsSchema,
  dofOptionsSchema,
  lensOptionsSchema,
  photoOptionsSchema,
  stageOptionsSchema,
  lightingOptionsSchema,
  deliverProfileRefSchema,
} from './request-payloads';
import { presetKindSchema } from './presets';
import { createObservationObjectSchema, observationOutcomeSchema, requirePoseOrComponent } from './observations';
import { publicationUrlSchema } from './publications';
import { addIssues } from './issues';
import { createExperimentInputIssues } from '../lib/experiment-rules';
import { requestPayloadIssues } from '../lib/request-payload';
import { RECIPE_REF_RE, deriveRequestIssues, lensOptionsIssues, stageOptionsIssues } from '../lib/request-rules';

export const listExperimentsInputSchema = z.object({ status: experimentStatusSchema.optional() });

export const idInputSchema = z.object({ id: z.string().min(1) });

export const getRunInputSchema = z.object({ run_id: z.string().min(1) });

export const getGenerationImageInputSchema = z.object({ short_id: z.string().min(1), width: z.number().optional() });

export const attachGenerationInputSchema = z.object({ run_id: z.string().min(1), generation_id: z.string().min(1) });

export const setEvaluationInputSchema = z.object({ run_id: z.string().min(1), evaluation: jsonObject.nullable() });

export const setDecisionInputSchema = z.object({ run_id: z.string().min(1), decision: jsonObject.nullable() });

export const getRequestInputSchema = z.object({ id: z.string().min(1), include_prompts: z.boolean().default(false) });

export const listRequestsInputSchema = z.object({
  status: requestStatusSchema.optional(),
  kind: requestKindFilterSchema.optional(),
  run_id: z.string().min(1).optional(),
  include_prompts: z.boolean().default(false),
});

export const getGenerationInputSchema = z.object({ generation_id: z.string().min(1), include_prompts: z.boolean().default(false) });

export const emptyInputSchema = z.object({});

export const createExperimentInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    character_id: z.string().min(1).optional(),
    recipe: z.string().min(1),
    parameters: jsonObject.optional(),
    seeds: z.array(z.number().int().nonnegative()).min(1).max(16).optional(),
    base_generation_id: z.string().min(1).optional(),
    arms: z
      .array(
        z.object({
          label: z.string().min(1),
          instruction: z.string().min(1).optional(),
          patches: patchesSchema.optional(),
        }),
      )
      .min(1)
      .max(9),
    idempotency_key: z.string().min(1),
  })
  .superRefine((value, ctx) => addIssues(ctx, createExperimentInputIssues(value)));

export const createRunInputSchema = createExperimentRunSchema
  .pick({ overrides: true, objective: true, parent_run_id: true, idempotency_key: true, variables: true })
  .extend({ experiment_id: z.string().min(1) });

/** REST の createRequestSchema と同じ封筒検証だが、`created_by` は tool 側で 'mcp' に固定するため受け取らない。 */
export const createRequestInputSchema = z
  .object({
    kind: creatableRequestKindSchema,
    payload: jsonObject,
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
    idempotency_key: z.string().min(1),
  })
  .superRefine((value, ctx) => addIssues(ctx, requestPayloadIssues(value.kind, value.payload)));

/** `redraw_generation` の入力。options は redrawPayloadSchema と同じ語彙 (schemas/request-payloads.ts) をそのまま流用する。 */
export const redrawGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: redrawOptionsSchema,
  idempotency_key: z.string().min(1),
});

/** `deliver_generation` の入力。options / profile は deliverPayloadSchema と同じ語彙 (schemas/request-payloads.ts) をそのまま流用する。 */
export const deliverGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  options: deliverOptionsSchema.optional(),
  profile: deliverProfileRefSchema.optional(),
  idempotency_key: z.string().min(1),
});

/** `dof_generation` の入力。options は dofPayloadSchema と同じ語彙 (schemas/request-payloads.ts) を平らに受ける。 */
export const dofGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  focus: dofOptionsSchema.shape.focus,
  f_number: dofOptionsSchema.shape.f_number,
  scope: dofOptionsSchema.shape.scope,
  viewfinder: dofOptionsSchema.shape.viewfinder,
  stand_at: dofOptionsSchema.shape.stand_at,
  nearer: dofOptionsSchema.shape.nearer,
  tilt: dofOptionsSchema.shape.tilt,
  bokeh: dofOptionsSchema.shape.bokeh,
  focal_length: dofOptionsSchema.shape.focal_length,
  idempotency_key: z.string().min(1),
});

/** `lens_generation` の入力。options は lensPayloadSchema と同じ語彙 (schemas/request-payloads.ts) を平らに受ける。 */
export const lensGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  center: lensOptionsSchema.shape.center,
  strength: lensOptionsSchema.shape.strength,
  shape: lensOptionsSchema.shape.shape,
  radius: lensOptionsSchema.shape.radius,
  idempotency_key: z.string().min(1),
}).superRefine((input, ctx) => addIssues(ctx, lensOptionsIssues(input)));

/** `photo_generation` の入力。options は photoPayloadSchema と同じ語彙 (schemas/request-payloads.ts) を平らに受ける。 */
export const photoGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  photo: photoOptionsSchema.shape.photo,
  place: photoOptionsSchema.shape.place,
  height: photoOptionsSchema.shape.height,
  stand_at: photoOptionsSchema.shape.stand_at,
  nearer: photoOptionsSchema.shape.nearer,
  focus: photoOptionsSchema.shape.focus,
  f_number: photoOptionsSchema.shape.f_number,
  tilt: photoOptionsSchema.shape.tilt,
  bokeh: photoOptionsSchema.shape.bokeh,
  focal_length: photoOptionsSchema.shape.focal_length,
  idempotency_key: z.string().min(1),
});

/** `stage_generation` の入力。options は stagePayloadSchema と同じ語彙 (schemas/request-payloads.ts) を平らに受ける。 */
export const stageGenerationInputSchema = z
  .object({
    generation_id: z.string().min(1),
    photo: stageOptionsSchema.shape.photo,
    place: stageOptionsSchema.shape.place,
    height: stageOptionsSchema.shape.height,
    backdrop: stageOptionsSchema.shape.backdrop,
    shadow_from: stageOptionsSchema.shape.shadow_from,
    frame: stageOptionsSchema.shape.frame,
    light: stageOptionsSchema.shape.light,
    idempotency_key: z.string().min(1),
  })
  .superRefine((input, ctx) => addIssues(ctx, stageOptionsIssues(input)));

/** `lighting_generation` の入力。 */
export const lightingGenerationInputSchema = z.object({
  generation_id: z.string().min(1),
  direction: lightingOptionsSchema.shape.direction,
  strength: lightingOptionsSchema.shape.strength,
  scene: lightingOptionsSchema.shape.scene,
  idempotency_key: z.string().min(1),
});

/** `derive_request` の入力。count と seeds の対応は request.json v1 (docs/generation-request.md) の request.seeds が Job 数と一致する必要があるための整合チェック。 */
export const deriveRequestInputSchema = z
  .object({
    from_generation_id: z.string().min(1),
    instruction: z.string().min(1),
    count: z.number().int().min(1).default(1),
    seeds: z.array(z.number().int()).optional(),
    parameters: jsonObject.optional(),
    patches: patchesSchema.optional(),
    replace_patches: z.boolean().default(false),
    semantic: z.object({ summary: z.string().min(1) }).passthrough(),
    reference: z.object({ aspect: z.string().optional(), instruction: z.string().optional() }).optional(),
    identity_override: z.string().trim().min(1).optional(),
    idempotency_key: z.string().min(1),
    recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
  })
  .superRefine((value, ctx) => addIssues(ctx, deriveRequestIssues(value)));

export const generationLineageInputSchema = z.object({
  generation_id: z.string().min(1),
  depth: z.number().int().min(0).max(10).optional(),
});

/** 1:1 with GET /api/v1/generations's filters (src/lib/generations.ts queryGenerations). */
export const listGenerationsInputSchema = z.object({
  tag: z.string().min(1).optional(),
  published: z.boolean().optional(),
  reference: z.boolean().optional(),
  rating: z.enum(['bad', 'neutral', 'good']).optional(),
  bookmark: z.boolean().optional(),
  character: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

/** `record_publication` の入力。generation_id は short_id / UUID どちらでも受ける。 */
export const recordPublicationInputSchema = z.object({
  generation_id: z.string().min(1),
  url: publicationUrlSchema.nullable().optional(),
  published_at: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
});

export const listCatalogInputSchema = z.object({ recipe_ref: z.string().regex(RECIPE_REF_RE).default('production') });

export const getCatalogPoseInputSchema = z.object({
  recipe: z.string().min(1),
  pose: z.string().min(1),
  recipe_ref: z.string().regex(RECIPE_REF_RE).default('production'),
});

export const listPresetsInputSchema = z.object({
  recipe: z.string().min(1).optional(),
  kind: presetKindSchema.optional(),
  include_deprecated: z.boolean().optional(),
});

export const getPresetInputSchema = z.object({
  recipe: z.string().min(1),
  kind: presetKindSchema,
  name: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export const setPoseReferenceInputSchema = z.object({
  recipe: z.string().min(1),
  pose: z.string().min(1),
  generation_id: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export const plainRenderInputSchema = z.object({
  recipe: z.string().min(1),
  pose: z.string().min(1),
  seed: z.number().int().optional(),
  idempotency_key: z.string().min(1).optional(),
  recipe_ref: z.string().regex(RECIPE_REF_RE).optional(),
});

export const listObservationsInputSchema = z.object({
  character: z.string().min(1).optional(),
  pose: z.string().min(1).optional(),
  component: z.string().min(1).optional(),
  parameter: z.string().min(1).optional(),
  outcome: observationOutcomeSchema.optional(),
  q: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
});

/** observed_at は import 専用 (JSONL 記録日) の欄なので持たない。base は createObservationObjectSchema (schemas/observations.ts) を借り、同じ pose/component 必須 refine をかけ直す。 */
export const recordObservationInputSchema = createObservationObjectSchema.omit({ observed_at: true }).superRefine(requirePoseOrComponent);
