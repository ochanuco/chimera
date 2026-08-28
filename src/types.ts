export interface Bindings {
  DB: D1Database;
  IMAGES: R2Bucket;
}

export type AppEnv = { Bindings: Bindings };

export type BatchStatus = 'created' | 'running' | 'completed' | 'partial' | 'failed';
export type JobStatus = 'created' | 'queued' | 'running' | 'completed' | 'ingested' | 'failed';
export type Rating = 'bad' | 'neutral' | 'good';
export type Actor = 'human' | 'claude';
export type CreatedBy = 'human' | 'claude';

export interface ExperimentRow {
  id: string;
  name: string;
  note: string | null;
  bookmark: number;
  created_at: string;
}

export interface BatchRow {
  id: string;
  short_id: string;
  experiment_id: string | null;
  raw_instruction: string | null;
  recipe: string | null;
  prompt: string | null;
  negative_prompt: string | null;
  parameters_json: string | null;
  git_commit: string | null;
  git_dirty: number;
  note: string | null;
  bookmark: number;
  status: BatchStatus;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface ComfyJobRow {
  id: string;
  batch_id: string;
  comfy_prompt_id: string | null;
  seed: number | null;
  job_index: number | null;
  status: JobStatus;
  idempotency_key: string;
  graph: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterRow {
  id: string;
  name: string;
  aliases: string | null;
}

export interface GenerationRow {
  id: string;
  short_id: string;
  batch_id: string;
  comfy_job_id: string;
  character_id: string | null;
  seed: number | null;
  original_filename: string | null;
  comfy_output_index: number | null;
  r2_object_key: string;
  note: string | null;
  rating: Rating | null;
  bookmark: number;
  semantic_schema_version: number | null;
  summary: string | null;
  semantic_json: string | null;
  summary_status: string | null;
  summary_model: string | null;
  summary_updated_at: string | null;
  created_at: string;
}

export interface GenerationAssetRow {
  id: string;
  generation_id: string;
  role: string;
  region: string;
  r2_object_key: string;
  content_type: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface StoryRow {
  id: string;
  name: string;
  description: string | null;
  note: string | null;
  bookmark: number;
  created_at: string;
}

export interface TagRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchReferenceRow {
  id: string;
  source_generation_id: string;
  target_batch_id: string;
  purpose: string | null;
  aspect: string | null;
  instruction: string | null;
  created_at: string;
}

export interface BatchRelationRow {
  id: string;
  source_batch_id: string;
  target_batch_id: string;
  type: string | null;
  actor: Actor;
  reason: string | null;
  raw_instruction: string | null;
  created_at: string;
}

export interface StoryRelationRow {
  id: string;
  story_id: string;
  source_batch_id: string;
  target_batch_id: string;
  raw_instruction: string | null;
  label: string | null;
  description: string | null;
  generated_by: string | null;
  created_at: string;
  updated_at: string;
}
