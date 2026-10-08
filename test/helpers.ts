import { env } from 'cloudflare:test';
import { app } from '../src/app';
import { mcpOutputSchemas } from '../src/schemas/mcp-output';

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
 * SSE frame (`event: message\ndata: {...}\n\n`), so this parses the `data:` line back out.
 * `Accept: application/json, text/event-stream` is required by the installed MCP server handler.
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
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * tools/call convenience wrapper; parses the first text content block as JSON when it looks like one.
 * structuredContent は宣言した outputSchema で検証する — ここで落とさないと schema とのずれが client 側の validation error として初めて表面化する。
 */
export async function mcpToolCall<T = unknown>(name: string, args: unknown, id: number | string = 1) {
  const { status, body } = await mcpCall<McpToolCallResult>('tools/call', { name, arguments: args }, id);
  const result = body.result;
  if (result && result.isError !== true && result.structuredContent !== undefined) {
    const schema = mcpOutputSchemas[name as keyof typeof mcpOutputSchemas];
    if (!schema) throw new Error(`no outputSchema registered for MCP tool '${name}'`);
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new Error(`MCP tool '${name}' structuredContent violates its outputSchema: ${parsed.error.message}`);
    }
  }
  const firstText = result?.content?.[0]?.text;
  let data: T | undefined;
  if (firstText) {
    try {
      data = JSON.parse(firstText) as T;
    } catch {
      data = undefined;
    }
  }
  return { status, result, data, structured: result?.structuredContent, isError: result?.isError === true, text: firstText };
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

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
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

export async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
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
 * Builds a real, decodable solid-color PNG at the given size (8-bit RGB, no interlace) — for
 * fixtures big enough that the Images binding actually resizes them, unlike TINY_PNG (1x1).
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
    const rowStart = y * rowBytes; // leading byte per row stays 0: filter type "none"
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

export interface PngChunkSpec {
  type: string;
  data: Uint8Array;
}

/**
 * General-purpose PNG builder for cases makeSolidPng can't cover: an explicit color type
 * (2 = RGB, 6 = RGBA), extra chunks spliced in before IDAT (tEXt/iTXt fixtures), and a
 * per-pixel color function (content that compresses differently than a solid fill).
 */
export async function makePngWithChunks(
  width: number,
  height: number,
  options: {
    colorType?: 2 | 6;
    pixel?: (x: number, y: number) => [number, number, number];
    extraChunks?: PngChunkSpec[];
  } = {},
): Promise<Uint8Array> {
  const colorType = options.colorType ?? 2;
  const channels = colorType === 6 ? 4 : 3;
  const pixel = options.pixel ?? (() => [0, 0, 0] as [number, number, number]);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, width);
  new DataView(ihdrData.buffer).setUint32(4, height);
  ihdrData[8] = 8;
  ihdrData[9] = colorType;
  const ihdr = pngChunk('IHDR', ihdrData);

  const rowBytes = 1 + width * channels;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * channels;
      raw.set(pixel(x, y), px);
      if (channels === 4) raw[px + 3] = 255;
    }
  }
  const idat = pngChunk('IDAT', await zlibDeflate(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));
  const extraChunks = (options.extraChunks ?? []).map((c) => pngChunk(c.type, c.data));

  const parts = [signature, ihdr, ...extraChunks, idat, iend];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `keyword\0text`, the body of a tEXt chunk (Latin-1). */
export function textChunkData(keyword: string, text: string): Uint8Array {
  const kw = new TextEncoder().encode(keyword);
  const txt = new TextEncoder().encode(text);
  const out = new Uint8Array(kw.length + 1 + txt.length);
  out.set(kw, 0);
  out.set(txt, kw.length + 1);
  return out;
}

/** `keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text`, the body of an iTXt chunk (UTF-8 text). */
export function itxtChunkData(keyword: string, text: string, compressed = false): Uint8Array {
  const kw = new TextEncoder().encode(keyword);
  const txt = new TextEncoder().encode(text);
  const out = new Uint8Array(kw.length + 5 + txt.length);
  let offset = 0;
  out.set(kw, offset);
  offset += kw.length;
  offset += 1; // keyword NUL terminator (byte already 0)
  out[offset] = compressed ? 1 : 0; // compression flag
  offset += 2; // + compression method (byte already 0)
  offset += 1; // empty language tag NUL terminator
  offset += 1; // empty translated keyword NUL terminator
  out.set(txt, offset);
  return out;
}

export interface TestRequestOverrides {
  id?: string;
  kind?: 'generate' | 'finalize' | 'redraw' | 'repair' | 'masked_redraw' | 'deliver' | 'dof' | 'import';
  status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  idempotency_key?: string;
  run_id?: string | null;
  created_by?: 'brain' | 'mcp' | 'gui' | 'system';
  created_at?: string;
  payload?: unknown;
  recipe?: string | null;
  raw_instruction?: string | null;
  parameters?: Record<string, unknown> | null;
  patches?: unknown[] | null;
  pose_fingerprint?: string | null;
  preset_versions?: unknown[] | null;
  git_commit?: string | null;
  git_dirty?: boolean;
  references?: { source_generation_id: string; purpose?: string; aspect?: string; instruction?: string }[] | null;
}

export interface TestRequest {
  id: string;
  short_id: string;
  kind: string;
  status: string;
}

const SHORT_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomShortId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => SHORT_ID_ALPHABET[b % SHORT_ID_ALPHABET.length]).join('');
}

/**
 * Inserts a Request whose resolution has already been reported (the state a worker leaves behind before it creates
 * Jobs), bypassing the claim / PUT resolution handshake. Defaults to a done generate Request.
 */
export async function createRequest(overrides: TestRequestOverrides = {}): Promise<{ status: number; body: TestRequest }> {
  const id = overrides.id ?? crypto.randomUUID();
  const kind = overrides.kind ?? 'generate';
  const status = overrides.status ?? 'done';
  const now = overrides.created_at ?? new Date().toISOString();
  const shortId = randomShortId();
  const payload = overrides.payload ?? { schema_version: 1, request: { instruction: overrides.raw_instruction ?? 'test' } };
  const parameters = overrides.parameters === undefined ? {} : overrides.parameters;
  await env.DB.prepare(
    `INSERT INTO requests (
       id, kind, status, payload_json, payload_hash, recipe_ref, run_id, idempotency_key, created_by, created_at, updated_at,
       finished_at, short_id, recipe, raw_instruction, parameters_json, patches_json, pose_fingerprint, preset_versions_json,
       git_commit, git_dirty
     ) VALUES (?, ?, ?, ?, ?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      kind,
      status,
      JSON.stringify(payload),
      'test',
      overrides.run_id ?? null,
      overrides.idempotency_key ?? crypto.randomUUID(),
      overrides.created_by ?? 'brain',
      now,
      now,
      status === 'done' ? now : null,
      shortId,
      overrides.recipe ?? null,
      overrides.raw_instruction ?? null,
      parameters === null ? null : JSON.stringify(parameters),
      overrides.patches ? JSON.stringify(overrides.patches) : null,
      overrides.pose_fingerprint ?? null,
      overrides.preset_versions ? JSON.stringify(overrides.preset_versions) : null,
      overrides.git_commit ?? null,
      overrides.git_dirty ? 1 : 0,
    )
    .run();
  for (const ref of overrides.references ?? []) {
    await env.DB.prepare(
      'INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), ref.source_generation_id, id, ref.purpose ?? null, ref.aspect ?? null, ref.instruction ?? null, now)
      .run();
  }
  return { status: 201, body: { id, short_id: shortId, kind, status } };
}

const requestIndexCounters = new Map<string, number>();

/** Inserts a Job under `requestId` the way POST /requests/{id}/jobs does (status created, request_id and source_generation_id set). */
export async function createJob(requestId: string, overrides: Record<string, unknown> = {}) {
  let index = 0;
  if ('index' in overrides) {
    index = overrides.index as number;
  } else {
    index = requestIndexCounters.get(requestId) ?? 0;
    requestIndexCounters.set(requestId, index + 1);
  }
  const id = crypto.randomUUID();
  const seed = (overrides.seed as number | undefined) ?? 123;
  const sourceGenerationId = (overrides.source_generation_id as string | null | undefined) ?? null;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO comfy_jobs (id, request_id, comfy_prompt_id, seed, job_index, status, idempotency_key, created_at, updated_at, source_generation_id)
     VALUES (?, ?, NULL, ?, ?, 'created', ?, ?, ?, ?)`,
  )
    .bind(id, requestId, seed, index, (overrides.idempotency_key as string | undefined) ?? crypto.randomUUID(), now, now, sourceGenerationId)
    .run();
  return {
    status: 201,
    body: { id, request_id: requestId, seed, index, source_generation_id: sourceGenerationId },
  };
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

/** Reports resolved values onto an existing Request, the way PUT /requests/{id}/resolution does. */
export async function resolveRequest(requestId: string, values: TestRequestOverrides): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE requests SET recipe = ?, raw_instruction = ?, parameters_json = ?, patches_json = ?, pose_fingerprint = ?,
       preset_versions_json = ?, git_commit = ?, git_dirty = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      values.recipe ?? null,
      values.raw_instruction ?? null,
      JSON.stringify(values.parameters ?? {}),
      values.patches ? JSON.stringify(values.patches) : null,
      values.pose_fingerprint ?? null,
      values.preset_versions ? JSON.stringify(values.preset_versions) : null,
      values.git_commit ?? null,
      values.git_dirty ? 1 : 0,
      now,
      requestId,
    )
    .run();
  for (const ref of values.references ?? []) {
    await env.DB.prepare(
      'INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), ref.source_generation_id, requestId, ref.purpose ?? null, ref.aspect ?? null, ref.instruction ?? null, now)
      .run();
  }
}

/** End-to-end helper: request -> job -> ingested generation. Pass `requestId` to add a Generation to an existing Request. */
export async function createGeneration(overrides: {
  requestOverrides?: TestRequestOverrides;
  requestId?: string;
  jobOverrides?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} = {}) {
  let request: TestRequest;
  if (overrides.requestId) {
    const row = await env.DB.prepare('SELECT id, short_id, kind, status FROM requests WHERE id = ?')
      .bind(overrides.requestId)
      .first<TestRequest>();
    if (!row) throw new Error(`request ${overrides.requestId} not found`);
    request = row;
    if (overrides.requestOverrides) await resolveRequest(row.id, overrides.requestOverrides);
  } else {
    const kind = overrides.requestOverrides?.kind ?? (overrides.jobOverrides?.source_generation_id ? 'finalize' : undefined);
    const created = await createRequest({ ...overrides.requestOverrides, ...(kind ? { kind } : {}) });
    request = created.body;
  }
  const job = await createJob(request.id, overrides.jobOverrides);
  const ingest = await ingestGeneration(job.body.id, {
    seed: 123,
    original_filename: 'out_00001_.png',
    comfy_output_index: 0,
    ...overrides.metadata,
  });
  if (ingest.status !== 201 && ingest.status !== 200) {
    throw new Error(`ingestGeneration failed with status ${ingest.status}: ${JSON.stringify(ingest.body)}`);
  }
  return { request, job: job.body, generation: ingest.body };
}

/** Empties every table that holds or points at Generations, in an order that respects the foreign keys. */
export async function clearGenerationData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE generations SET refines_generation_id = NULL'),
    env.DB.prepare('UPDATE comfy_jobs SET source_generation_id = NULL'),
    env.DB.prepare('UPDATE experiments SET base_generation_id = NULL'),
    env.DB.prepare('UPDATE requests SET run_id = NULL'),
    env.DB.prepare('DELETE FROM workbenches'),
    env.DB.prepare('DELETE FROM generation_assets'),
    env.DB.prepare('DELETE FROM generation_safety'),
    env.DB.prepare('DELETE FROM pairwise_judgments'),
    env.DB.prepare('DELETE FROM experiment_promotions'),
    env.DB.prepare('DELETE FROM experiment_runs'),
    env.DB.prepare('DELETE FROM generation_publications'),
    env.DB.prepare('DELETE FROM preset_references'),
    env.DB.prepare('DELETE FROM presets'),
    env.DB.prepare('DELETE FROM request_references'),
    env.DB.prepare('DELETE FROM node_timings'),
    env.DB.prepare('DELETE FROM prompt_timings'),
    env.DB.prepare('DELETE FROM request_attempt_timings'),
    env.DB.prepare('DELETE FROM generation_tags'),
    env.DB.prepare('DELETE FROM generations'),
    env.DB.prepare('DELETE FROM comfy_jobs'),
    env.DB.prepare('DELETE FROM requests'),
    env.DB.prepare('DELETE FROM experiments'),
  ]);
}

/** Deletes every Request nothing depends on yet (no Job, no Generation), so a test sees only its own queue. */
export async function clearRequests(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM node_timings WHERE prompt_timing_id IN (SELECT id FROM prompt_timings WHERE request_id NOT IN (SELECT request_id FROM comfy_jobs UNION SELECT request_id FROM generations))'),
    env.DB.prepare('DELETE FROM prompt_timings WHERE request_id NOT IN (SELECT request_id FROM comfy_jobs UNION SELECT request_id FROM generations)'),
    env.DB.prepare('DELETE FROM request_attempt_timings WHERE request_id NOT IN (SELECT request_id FROM comfy_jobs UNION SELECT request_id FROM generations)'),
    env.DB.prepare('DELETE FROM request_references WHERE target_request_id NOT IN (SELECT request_id FROM comfy_jobs UNION SELECT request_id FROM generations)'),
    env.DB.prepare('DELETE FROM requests WHERE id NOT IN (SELECT request_id FROM comfy_jobs UNION SELECT request_id FROM generations)'),
  ]);
}
