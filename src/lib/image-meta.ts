const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ImageMeta {
  width: number | null;
  height: number | null;
  size: number;
}

/**
 * Reads resolution + size directly from R2 without any D1 schema change, so it
 * works retroactively on every already-ingested image. A ranged get of the
 * first 26 bytes covers the PNG signature (8B) + IHDR chunk header/width/height
 * (up to offset 24); width/height stay null for non-PNG or truncated objects.
 */
export async function getImageMeta(bucket: R2Bucket, key: string): Promise<ImageMeta | null> {
  const object = await bucket.get(key, { range: { offset: 0, length: 26 } });
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width: number | null = null;
  let height: number | null = null;
  if (bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    width = view.getUint32(16, false);
    height = view.getUint32(20, false);
  }

  return { width, height, size: object.size };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
