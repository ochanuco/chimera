import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { formatBytes, getImageMeta } from '../src/lib/image-meta';

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
