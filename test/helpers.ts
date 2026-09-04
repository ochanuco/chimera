import { env } from 'cloudflare:test';
import { app } from '../src/app';

const BASE = 'https://chimera.test';

export async function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(`${BASE}${path}`, init, env);
}

export async function getJson<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const res = await req(path);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

export async function postJson<T = unknown>(
  path: string,
  data: unknown,
  method: 'POST' | 'PATCH' | 'PUT' = 'POST',
): Promise<{ status: number; body: T }> {
  const res = await req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

export async function del<T = unknown>(path: string): Promise<{ status: number; body: T | null }> {
  const res = await req(path, { method: 'DELETE' });
  if (res.status === 204) return { status: res.status, body: null };
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

export interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Drives POST /mcp with a plain JSON-RPC request body. The stateless handler answers with an
 * SSE frame (`event: message\ndata: {...}\n\n`) rather than a bare JSON body, so this parses the
 * `data:` line back out. `Accept: application/json, text/event-stream` is required by the
 * installed @modelcontextprotocol/server handler (checked by hitting the endpoint directly).
 */
export async function mcpCall<T = unknown>(
  method: string,
  params: unknown,
  id: number | string = 1,
): Promise<{ status: number; body: McpJsonRpcResponse<T> }> {
  const res = await req('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  const body = dataLine
    ? (JSON.parse(dataLine.slice('data: '.length)) as McpJsonRpcResponse<T>)
    : ({} as McpJsonRpcResponse<T>);
  return { status: res.status, body };
}

export interface McpToolCallResult {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
}

/** tools/call convenience wrapper; parses the first text content block as JSON when it looks like one. */
export async function mcpToolCall<T = unknown>(name: string, args: unknown, id: number | string = 1) {
  const { status, body } = await mcpCall<McpToolCallResult>('tools/call', { name, arguments: args }, id);
  const result = body.result;
  const firstText = result?.content?.[0]?.text;
  let data: T | undefined;
  if (firstText) {
    try {
      data = JSON.parse(firstText) as T;
    } catch {
      data = undefined;
    }
  }
  return { status, result, data, isError: result?.isError === true, text: firstText };
}

// 1x1 transparent PNG.
export const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
  0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Builds a real, decodable solid-color PNG at the given size (8-bit RGB, no interlace).
 * Used where a fixture must be big enough for the Images binding to actually resize —
 * TINY_PNG (1x1) never shrinks under the default scale-down fit.
 */
export async function makeSolidPng(width: number, height: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, width);
  new DataView(ihdrData.buffer).setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  const ihdr = pngChunk('IHDR', ihdrData);

  const rowBytes = 1 + width * 3;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes; // raw[rowStart] stays 0: filter type "none"
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw.set(rgb, px);
    }
  }
  const idat = pngChunk('IDAT', await zlibDeflate(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  for (const part of [signature, ihdr, idat, iend]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function createBatch(overrides: Record<string, unknown> = {}) {
  return postJson<{ id: string; short_id: string; status: string }>('/api/v1/batches', {
    idempotency_key: crypto.randomUUID(),
    prompt: 'a test prompt',
    ...overrides,
  });
}

// Track next index per batch for default calls
const batchIndexCounters = new Map<string, number>();

export async function createJob(batchId: string, overrides: Record<string, unknown> = {}) {
  let index = 0;
  if (!('index' in overrides)) {
    const current = batchIndexCounters.get(batchId) ?? 0;
    index = current;
    batchIndexCounters.set(batchId, current + 1);
  }

  return postJson<{ id: string; batch_id: string; seed: number; index: number }>(
    `/api/v1/batches/${batchId}/jobs`,
    {
      idempotency_key: crypto.randomUUID(),
      seed: 123,
      index,
      ...overrides,
    },
  );
}

export interface IngestResult {
  id: string;
  short_id: string;
  canonical_url: string;
  r2_object_key: string;
}

export async function ingestGeneration(
  jobId: string,
  metadata: Record<string, unknown>,
  imageBytes: Uint8Array = TINY_PNG,
): Promise<{ status: number; body: IngestResult }> {
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set('image', new File([imageBytes], 'out.png', { type: 'image/png' }));

  const res = await req(`/api/v1/jobs/${jobId}/generations`, {
    method: 'POST',
    body: form,
  });
  const body = (await res.json()) as IngestResult;
  return { status: res.status, body };
}

/** Inserts a graph directly into env.DB, bypassing PATCH /api/v1/jobs/{id} — leaves render_facts_json NULL (lazy-extraction path). */
export async function setJobGraph(jobId: string, graph: unknown): Promise<void> {
  await env.DB.prepare('UPDATE comfy_jobs SET graph = ? WHERE id = ?').bind(JSON.stringify(graph), jobId).run();
}

/** End-to-end helper: batch -> job -> ingested generation. */
export async function createGeneration(overrides: {
  batchOverrides?: Record<string, unknown>;
  jobOverrides?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} = {}) {
  const batch = await createBatch(overrides.batchOverrides);
  if (batch.status !== 201 && batch.status !== 200) {
    throw new Error(`createBatch failed with status ${batch.status}: ${JSON.stringify(batch.body)}`);
  }
  const job = await createJob(batch.body.id, overrides.jobOverrides);
  if (job.status !== 201 && job.status !== 200) {
    throw new Error(`createJob failed with status ${job.status}: ${JSON.stringify(job.body)}`);
  }
  const ingest = await ingestGeneration(job.body.id, {
    seed: 123,
    original_filename: 'out_00001_.png',
    comfy_output_index: 0,
    ...overrides.metadata,
  });
  if (ingest.status !== 201 && ingest.status !== 200) {
    throw new Error(`ingestGeneration failed with status ${ingest.status}: ${JSON.stringify(ingest.body)}`);
  }
  return { batch: batch.body, job: job.body, generation: ingest.body };
}
