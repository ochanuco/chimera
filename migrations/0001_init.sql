-- ComfyUI Generation Manager: initial schema
-- See docs/domain-model.md for entity semantics.

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  bookmark INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  experiment_id TEXT REFERENCES experiments(id),
  raw_instruction TEXT,
  recipe TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  parameters_json TEXT,
  git_commit TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  bookmark INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'running', 'completed', 'partial', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_batches_experiment_id ON batches(experiment_id);
CREATE INDEX idx_batches_status ON batches(status);
CREATE INDEX idx_batches_bookmark ON batches(bookmark);
CREATE INDEX idx_batches_created_at ON batches(created_at);

CREATE TABLE comfy_jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  comfy_prompt_id TEXT,
  seed INTEGER,
  job_index INTEGER,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'queued', 'running', 'completed', 'ingested', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_comfy_jobs_batch_id ON comfy_jobs(batch_id);
CREATE INDEX idx_comfy_jobs_comfy_prompt_id ON comfy_jobs(comfy_prompt_id);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT
);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  comfy_job_id TEXT NOT NULL REFERENCES comfy_jobs(id),
  character_id TEXT REFERENCES characters(id),
  seed INTEGER,
  original_filename TEXT,
  comfy_output_index INTEGER,
  r2_object_key TEXT NOT NULL,
  note TEXT,
  rating TEXT CHECK (rating IN ('bad', 'neutral', 'good')),
  bookmark INTEGER NOT NULL DEFAULT 0,
  semantic_schema_version INTEGER,
  summary TEXT,
  semantic_json TEXT,
  summary_status TEXT,
  summary_model TEXT,
  summary_updated_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (comfy_job_id, comfy_output_index)
);

CREATE INDEX idx_generations_batch_id ON generations(batch_id);
CREATE INDEX idx_generations_character_id ON generations(character_id);
CREATE INDEX idx_generations_rating ON generations(rating);
CREATE INDEX idx_generations_bookmark ON generations(bookmark);
CREATE INDEX idx_generations_created_at ON generations(created_at);
CREATE INDEX idx_generations_original_filename ON generations(original_filename);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  note TEXT,
  bookmark INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generation_tags (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES generations(id),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT CHECK (created_by IN ('human', 'claude')),
  created_at TEXT NOT NULL,
  UNIQUE (generation_id, tag_id)
);

CREATE INDEX idx_generation_tags_tag_id ON generation_tags(tag_id);

CREATE TABLE batch_tags (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT CHECK (created_by IN ('human', 'claude')),
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, tag_id)
);

CREATE INDEX idx_batch_tags_tag_id ON batch_tags(tag_id);

CREATE TABLE story_tags (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT CHECK (created_by IN ('human', 'claude')),
  created_at TEXT NOT NULL,
  UNIQUE (story_id, tag_id)
);

CREATE INDEX idx_story_tags_tag_id ON story_tags(tag_id);

CREATE TABLE experiment_tags (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT CHECK (created_by IN ('human', 'claude')),
  created_at TEXT NOT NULL,
  UNIQUE (experiment_id, tag_id)
);

CREATE INDEX idx_experiment_tags_tag_id ON experiment_tags(tag_id);

CREATE TABLE batch_references (
  id TEXT PRIMARY KEY,
  source_generation_id TEXT NOT NULL REFERENCES generations(id),
  target_batch_id TEXT NOT NULL REFERENCES batches(id),
  purpose TEXT,
  aspect TEXT,
  instruction TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_batch_references_source_generation_id ON batch_references(source_generation_id);
CREATE INDEX idx_batch_references_target_batch_id ON batch_references(target_batch_id);

CREATE TABLE batch_relations (
  id TEXT PRIMARY KEY,
  source_batch_id TEXT NOT NULL REFERENCES batches(id),
  target_batch_id TEXT NOT NULL REFERENCES batches(id),
  type TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('human', 'claude')),
  reason TEXT,
  raw_instruction TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_batch_relations_source_batch_id ON batch_relations(source_batch_id);
CREATE INDEX idx_batch_relations_target_batch_id ON batch_relations(target_batch_id);

CREATE TABLE story_relations (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  source_batch_id TEXT NOT NULL REFERENCES batches(id),
  target_batch_id TEXT NOT NULL REFERENCES batches(id),
  raw_instruction TEXT,
  label TEXT,
  description TEXT,
  generated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_story_relations_story_id ON story_relations(story_id);
CREATE INDEX idx_story_relations_source_batch_id ON story_relations(source_batch_id);
CREATE INDEX idx_story_relations_target_batch_id ON story_relations(target_batch_id);
