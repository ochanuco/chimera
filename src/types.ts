export interface Bindings {
  DB: D1Database;
  IMAGES: R2Bucket;
  IMAGE_TRANSFORM: ImagesBinding;
}

export type AppEnv = { Bindings: Bindings };

export type BatchStatus = 'created' | 'running' | 'completed' | 'partial' | 'failed';
export type JobStatus = 'created' | 'queued' | 'running' | 'completed' | 'ingested' | 'failed';
export type Rating = 'bad' | 'neutral' | 'good';
export type Actor = 'human' | 'claude';
export type CreatedBy = 'human' | 'claude';

export type ExperimentStatus = 'active' | 'stabilized' | 'promoted' | 'abandoned';
export type PromotionStatus = 'proposed' | 'applied' | 'rejected';

export interface ExperimentRow {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  note: string | null;
  status: ExperimentStatus;
  base_recipe: string | null;
  base_parameters_json: string | null;
  character_id: string | null;
  bookmark: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ExperimentRunRow {
  id: string;
  experiment_id: string;
  run_index: number;
  parent_run_id: string | null;
  batch_id: string | null;
  generation_id: string | null;
  overrides_json: string;
  objective: string | null;
  evaluation_json: string | null;
  decision_json: string | null;
  note: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export type JudgmentVerdict = 'left' | 'right' | 'tie';
export type JudgmentWinner = 'baseline' | 'arm' | 'tie';

export interface PairwiseJudgmentRow {
  id: string;
  experiment_id: string;
  baseline_run_id: string;
  arm_run_id: string;
  seed: number;
  left_generation_id: string;
  right_generation_id: string;
  verdict: JudgmentVerdict;
  judged_at: string;
}

export interface ExperimentPromotionRow {
  id: string;
  experiment_id: string;
  source_run_id: string | null;
  promoted_overrides_json: string;
  status: PromotionStatus;
  target_repository: string;
  target_path: string | null;
  commit_sha: string | null;
  pull_request_url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
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
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
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
