import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { extractPngTextChunk, formatBytes, getImageMeta, pngHasTransparency } from '../src/lib/image-meta';
import { itxtChunkData, makePngWithChunks, textChunkData } from './helpers';

/** Minimal PNG: signature + IHDR chunk header carrying width/height. CRC is not validated by our parser. */
function makePng(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length = 13
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
    0x00, 0x00, 0x00, 0x00, // CRC (unchecked)
  ]);
}

describe('getImageMeta', () => {
  it('returns width/height/size for a PNG object', async () => {
    const key = `image-meta-test/${crypto.randomUUID()}.png`;
    const bytes = makePng(640, 480);
    await env.IMAGES.put(key, bytes);

    const meta = await getImageMeta(env.IMAGES, key);
    expect(meta).not.toBeNull();
    expect(meta?.width).toBe(640);
    expect(meta?.height).toBe(480);
    expect(meta?.size).toBe(bytes.byteLength);
  });

  it('returns null width/height for a non-PNG object but a correct size', async () => {
    const key = `image-meta-test/${crypto.randomUUID()}.bin`;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await env.IMAGES.put(key, bytes);

    const meta = await getImageMeta(env.IMAGES, key);
    expect(meta).not.toBeNull();
    expect(meta?.width).toBeNull();
    expect(meta?.height).toBeNull();
    expect(meta?.size).toBe(bytes.byteLength);
  });

  it('returns null for a missing object', async () => {
    const meta = await getImageMeta(env.IMAGES, `image-meta-test/does-not-exist-${crypto.randomUUID()}.png`);
    expect(meta).toBeNull();
  });
});

describe('pngHasTransparency', () => {
  it('is true for an RGBA (color type 6) PNG', async () => {
    const bytes = await makePngWithChunks(4, 4, { colorType: 6 });
    expect(pngHasTransparency(bytes)).toBe(true);
  });

  it('is false for an RGB (color type 2) PNG without a tRNS chunk', async () => {
    const bytes = await makePngWithChunks(4, 4, { colorType: 2 });
    expect(pngHasTransparency(bytes)).toBe(false);
  });

  it('is true for an RGB PNG carrying a tRNS chunk', async () => {
    const bytes = await makePngWithChunks(4, 4, {
      colorType: 2,
      extraChunks: [{ type: 'tRNS', data: new Uint8Array([0, 0, 0, 0, 0, 0]) }],
    });
    expect(pngHasTransparency(bytes)).toBe(true);
  });

  it('is null for non-PNG bytes', () => {
    expect(pngHasTransparency(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('is null for a truncated PNG missing IHDR', () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngHasTransparency(signature)).toBeNull();
  });
});

describe('extractPngTextChunk', () => {
  it('reads a tEXt chunk by keyword', async () => {
    const bytes = await makePngWithChunks(4, 4, {
      extraChunks: [{ type: 'tEXt', data: textChunkData('prompt', '{"1":{}}') }],
    });
    expect(extractPngTextChunk(bytes, 'prompt')).toBe('{"1":{}}');
  });

  it('reads an uncompressed iTXt chunk by keyword', async () => {
    const bytes = await makePngWithChunks(4, 4, {
      extraChunks: [{ type: 'iTXt', data: itxtChunkData('prompt', '{"1":{}}') }],
    });
    expect(extractPngTextChunk(bytes, 'prompt')).toBe('{"1":{}}');
  });

  it('ignores a compressed iTXt chunk', async () => {
    const bytes = await makePngWithChunks(4, 4, {
      extraChunks: [{ type: 'iTXt', data: itxtChunkData('prompt', 'ignored', true) }],
    });
    expect(extractPngTextChunk(bytes, 'prompt')).toBeNull();
  });

  it('returns null when the keyword is absent', async () => {
    const bytes = await makePngWithChunks(4, 4, {
      extraChunks: [{ type: 'tEXt', data: textChunkData('other', 'value') }],
    });
    expect(extractPngTextChunk(bytes, 'prompt')).toBeNull();
  });

  it('returns null for non-PNG or truncated input', () => {
    expect(extractPngTextChunk(new Uint8Array([1, 2, 3]), 'prompt')).toBeNull();
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(extractPngTextChunk(signature, 'prompt')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats sub-1024 sizes as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats MB with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1.8 * 1024 * 1024)).toBe('1.8 MB');
  });
});
