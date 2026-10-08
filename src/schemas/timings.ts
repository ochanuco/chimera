import { z } from 'zod';

const epochMs = z.number().int().nonnegative().nullish();

export const timingNodeSchema = z.object({
  node_id: z.string().min(1),
  class_type: z.string().min(1),
  role: z.string().min(1).nullish(),
  cached: z.boolean(),
  started_at: epochMs,
  ended_at: epochMs,
  steps_total: z.number().int().nonnegative().nullish(),
  step_ms: z.array(z.number().nonnegative()).nullish(),
});

export const timingPromptSchema = z.object({
  prompt_id: z.string().min(1),
  purpose: z.string().min(1),
  resumed: z.boolean().default(false),
  submitted_at: epochMs,
  execution_start_at: epochMs,
  execution_end_at: epochMs,
  outputs_ready_at: epochMs,
  ingested_at: epochMs,
  status: z.enum(['success', 'error', 'interrupted', 'unknown']),
  nodes: z.array(timingNodeSchema).default([]),
});

export const timingEnvSchema = z.object({
  comfyui_version: z.string().nullish(),
  argv: z.array(z.string()).nullish(),
  attention: z.string().nullish(),
  pytorch_version: z.string().nullish(),
  worker_commit: z.string().nullish(),
  worker_dirty: z.boolean().nullish(),
  gpu_name: z.string().nullish(),
  gpu_driver: z.string().nullish(),
});

export const putTimingsSchema = z.object({
  worker_id: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  version: z.enum(['v1', 'v2']),
  source: z.enum(['worker', 'comfy_history', 'requests']),
  status: z.enum(['done', 'failed', 'cancelled', 'released']),
  claimed_at: epochMs,
  finished_at: epochMs,
  env: timingEnvSchema.nullish(),
  cold_load: z.boolean().nullish(),
  prompts: z.array(timingPromptSchema).default([]),
});

export type PutTimingsInput = z.infer<typeof putTimingsSchema>;

export const statsPeriodSchema = z.enum(['7d', '14d', '30d', '90d', 'all']);
export const statsColdSchema = z.enum(['include', 'exclude']);
