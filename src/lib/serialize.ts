import { toBool } from './db';
import type { BatchRow, GenerationRow, StoryRow, StoryRelationRow } from '../types';

export function canonicalGenerationUrl(origin: string, shortId: string): string {
  return `${origin}/g/${shortId}`;
}

export function canonicalBatchUrl(origin: string, shortId: string): string {
  return `${origin}/b/${shortId}`;
}

export function generationImageUrl(origin: string, shortId: string): string {
  return `${origin}/g/${shortId}/image`;
}

export function serializeBatch(row: BatchRow) {
  return {
    id: row.id,
    short_id: row.short_id,
    experiment_id: row.experiment_id,
    raw_instruction: row.raw_instruction,
    recipe: row.recipe,
    prompt: row.prompt,
    negative_prompt: row.negative_prompt,
    parameters: row.parameters_json ? JSON.parse(row.parameters_json) : null,
    git_commit: row.git_commit,
    git_dirty: toBool(row.git_dirty),
    note: row.note,
    bookmark: toBool(row.bookmark),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type GenerationLightSource = Pick<
  GenerationRow,
  'id' | 'short_id' | 'rating' | 'bookmark' | 'character_id' | 'created_at'
>;

/** Lightweight Generation representation embedded in Batch/Story responses. */
export function serializeGenerationLight(row: GenerationLightSource, origin: string) {
  return {
    id: row.id,
    short_id: row.short_id,
    canonical_url: canonicalGenerationUrl(origin, row.short_id),
    image_url: generationImageUrl(origin, row.short_id),
    thumbnail_url: generationImageUrl(origin, row.short_id),
    rating: row.rating,
    bookmark: toBool(row.bookmark),
    character_id: row.character_id,
    created_at: row.created_at,
  };
}

export function serializeStory(row: StoryRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    note: row.note,
    bookmark: toBool(row.bookmark),
    created_at: row.created_at,
  };
}

export function serializeStoryRelation(row: StoryRelationRow) {
  return {
    id: row.id,
    story_id: row.story_id,
    source_batch_id: row.source_batch_id,
    target_batch_id: row.target_batch_id,
    label: row.label,
    description: row.description,
    raw_instruction: row.raw_instruction,
    generated_by: row.generated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
