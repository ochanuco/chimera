// Thumbnail-sized preview for a Generation (long edge <=1024px, WebP), stored
// alongside the original so every thumbnail-sized use in the GUI/API stops
// paying for the full-size PNG. Created lazily on first request.

import type { Bindings, GenerationRow } from '../types';

/** Images binding の `.input()` はここを超えると ImagesError を投げるので、その前に断る。get_generation_image (MCP) と ここの両方が共有する。 */
export const MAX_TRANSFORM_INPUT_BYTES = 20 * 1024 * 1024;

export type GenerationPreviewSource = Pick<GenerationRow, 'id' | 'r2_object_key'>;

export interface GenerationPreview {
  body: ReadableStream | Uint8Array;
  contentType: string;
  /** true: served from (or just written to) the stored preview object. false: original bytes returned as a fallback. */
  stored: boolean;
}

export function generationPreviewR2Key(generationId: string): string {
  return `generations/${generationId}/preview.webp`;
}

/**
 * Returns the stored preview if one exists; otherwise builds it from the original (downscaled to
 * fit 1024x1024, re-encoded as WebP) and stores it for next time. Falls back to the original bytes,
 * unmodified, when the original is over the transform input limit or the transform throws (e.g. a
 * corrupt source) — same idiom as `get_generation_image` in src/mcp.ts. Returns null when neither the
 * preview nor the original exists in R2.
 */
export async function loadOrCreateGenerationPreview(
  env: Bindings,
  generation: GenerationPreviewSource,
): Promise<GenerationPreview | null> {
  const previewKey = generationPreviewR2Key(generation.id);

  const existing = await env.IMAGES.get(previewKey);
  if (existing) {
    return { body: existing.body, contentType: 'image/webp', stored: true };
  }

  const original = await env.IMAGES.get(generation.r2_object_key);
  if (!original) return null;

  const fallback = (body: ReadableStream): GenerationPreview => ({
    body,
    contentType: original.httpMetadata?.contentType ?? 'image/png',
    stored: false,
  });

  if (original.size > MAX_TRANSFORM_INPUT_BYTES) return fallback(original.body);

  // transform 用と、失敗時のフォールバック用に body を分ける。成功すればフォールバック側は誰も読まないまま捨てられる。
  const [forTransform, forFallback] = original.body.tee();

  try {
    const result = await env.IMAGE_TRANSFORM.input(forTransform)
      .transform({ width: 1024, height: 1024, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 80 });
    const bytes = new Uint8Array(await result.response().arrayBuffer());
    await env.IMAGES.put(previewKey, bytes, { httpMetadata: { contentType: 'image/webp' } });
    return { body: bytes, contentType: 'image/webp', stored: true };
  } catch {
    return fallback(forFallback);
  }
}

/**
 * Guarantees a stored preview exists for `generation`, creating it from the original if needed.
 * Returns false when neither object exists in R2 (or the original was too large / unusable and no
 * preview could be created). For callers that only need the guarantee, not the bytes — e.g. a
 * scheduled purge of originals that must not delete one before a preview backs it up.
 */
export async function ensureGenerationPreview(env: Bindings, generation: GenerationPreviewSource): Promise<boolean> {
  const preview = await loadOrCreateGenerationPreview(env, generation);
  return preview?.stored ?? false;
}
