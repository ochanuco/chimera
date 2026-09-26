const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ImageMeta {
  width: number | null;
  height: number | null;
  size: number;
}

/** Reads width/height from the PNG signature + IHDR chunk header (offsets 0-24); null for non-PNG or truncated input. */
export function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

/** Walks the chunk list of a full (not ranged) PNG buffer. Stops without throwing on a truncated/corrupt input -- callers just see "no more chunks". */
function walkPngChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    if (type === 'IEND') break;
    offset = dataEnd + 4; // skip the trailing CRC
  }
  return chunks;
}

/**
 * True when the PNG can carry visible transparency (colour type 4/6, or a `tRNS` chunk).
 * Recompression must skip these -- RGB under alpha=0 isn't preserved by a lossless re-encode, and ComfyUI's LoadImage reads it anyway.
 */
export function pngHasTransparency(bytes: Uint8Array): boolean | null {
  const chunks = walkPngChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 10) return null;

  const colorType = ihdr.data[9];
  if (colorType === 4 || colorType === 6) return true;
  return chunks.some((c) => c.type === 'tRNS');
}

const LATIN1_DECODER = new TextDecoder('latin1');
const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * Returns the text of the first `tEXt` or uncompressed `iTXt` chunk whose keyword matches.
 * Compressed `iTXt` and all `zTXt` are ignored (would need zlib inflate, not worth it for a lookup that fails soft anyway).
 */
export function extractPngTextChunk(bytes: Uint8Array, keyword: string): string | null {
  const chunks = walkPngChunks(bytes);

  for (const chunk of chunks) {
    if (chunk.type === 'tEXt') {
      const nul = chunk.data.indexOf(0);
      if (nul === -1) continue;
      if (LATIN1_DECODER.decode(chunk.data.subarray(0, nul)) !== keyword) continue;
      return LATIN1_DECODER.decode(chunk.data.subarray(nul + 1));
    }

    if (chunk.type === 'iTXt') {
      const keywordEnd = chunk.data.indexOf(0);
      if (keywordEnd === -1) continue;
      if (LATIN1_DECODER.decode(chunk.data.subarray(0, keywordEnd)) !== keyword) continue;

      const compressionFlag = chunk.data[keywordEnd + 1];
      const languageEnd = chunk.data.indexOf(0, keywordEnd + 3); // +2 (flag, method) skips to the language tag
      if (compressionFlag === undefined || languageEnd === -1) continue;
      const translatedEnd = chunk.data.indexOf(0, languageEnd + 1);
      if (translatedEnd === -1) continue;
      if (compressionFlag !== 0) continue; // compressed iTXt: not supported, keep looking

      return UTF8_DECODER.decode(chunk.data.subarray(translatedEnd + 1));
    }
  }
  return null;
}

/**
 * Reads resolution + size directly from R2 without any D1 schema change, so it works
 * retroactively on every already-ingested image. Ranged get of the first 26 bytes covers
 * the PNG signature + IHDR width/height; stays null for non-PNG or truncated objects.
 */
export async function getImageMeta(bucket: R2Bucket, key: string): Promise<ImageMeta | null> {
  const object = await bucket.get(key, { range: { offset: 0, length: 26 } });
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  const dimensions = parsePngDimensions(bytes);

  return { width: dimensions?.width ?? null, height: dimensions?.height ?? null, size: object.size };
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

/** `1536×1536 · 2.9 MB`, size-only, or null when there's no ImageMeta (pre-backfill row). Used by Generation Detail. */
export function formatImageMetaText(meta: ImageMeta | null): string | null {
  if (!meta) return null;
  if (meta.width !== null && meta.height !== null) {
    return `${meta.width}×${meta.height} · ${formatBytes(meta.size)}`;
  }
  return formatBytes(meta.size);
}
