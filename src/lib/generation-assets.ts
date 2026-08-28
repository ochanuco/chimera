const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': 'png',
  'application/json': 'json',
  'image/vnd.adobe.photoshop': 'psd',
};

export function extForContentType(contentType: string): string {
  return CONTENT_TYPE_EXT[contentType] ?? 'bin';
}

/** Deterministic R2 key for a Generation asset. region '' means "whole image". */
export function generationAssetR2Key(
  generationId: string,
  role: string,
  region: string,
  contentType: string,
): string {
  const ext = extForContentType(contentType);
  const suffix = region ? `${role}.${region}.${ext}` : `${role}.${ext}`;
  return `generations/${generationId}/assets/${suffix}`;
}
