// POST /api/v1/requests (createRequestSchema) の request.json 契約: loose な封筒が未知キーを保つ所、strict な封筒が弾く所、
// 省略時に入る値、400 の本文。検証ライブラリを差し替えても変わらないことを固定する。
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createGeneration, postJson } from './helpers';

interface RequestBody {
  id: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  recipe_ref: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

const generatePayload = (extra: Record<string, unknown> = {}, request: Record<string, unknown> = {}, generation: Record<string, unknown> = {}) => ({
  schema_version: 1,
  request: { instruction: 'contract', count: 1, ...request },
  generation: { recipe: 'yukari', parameters: {}, ...generation },
  ...extra,
});

const generateBody = (payload: Record<string, unknown>) => ({
  kind: 'generate',
  payload,
  idempotency_key: crypto.randomUUID(),
  created_by: 'brain',
});

const importBody = (extra: Record<string, unknown> = {}) => ({
  kind: 'import',
  status: 'done',
  idempotency_key: `import-${crypto.randomUUID()}`,
  created_by: 'brain',
  parameters: { kind: 'hand-edit' },
  ...extra,
});

interface ResolutionRow {
  recipe: string | null;
  raw_instruction: string | null;
  parameters_json: string | null;
  patches_json: string | null;
  pose_fingerprint: string | null;
  preset_versions_json: string | null;
  git_commit: string | null;
  git_dirty: number;
  payload_json: string;
}

async function resolutionRow(id: string): Promise<ResolutionRow> {
  const row = await env.DB.prepare(
    'SELECT recipe, raw_instruction, parameters_json, patches_json, pose_fingerprint, preset_versions_json, git_commit, git_dirty, payload_json FROM requests WHERE id = ?',
  )
    .bind(id)
    .first<ResolutionRow>();
  return row!;
}

describe('createRequestSchema: loose envelopes keep unknown keys', () => {
  it('generate: unknown keys at the payload top level and inside request / generation are stored as sent', async () => {
    const payload = generatePayload(
      {
        semantic: { summary: 'contract', anything: [1, 2] },
        experiment: { note: 'free form' },
        future_block: { nested: { deep: true } },
      },
      { future_request_key: 'r', seeds: [1] },
      { future_generation_key: { a: 1 } },
    );

    const res = await postJson<RequestBody>('/api/v1/requests', generateBody(payload));
    expect(res.status).toBe(201);
    expect(res.body.payload).toMatchObject({
      semantic: { summary: 'contract', anything: [1, 2] },
      experiment: { note: 'free form' },
      future_block: { nested: { deep: true } },
      request: { future_request_key: 'r', seeds: [1] },
      generation: { future_generation_key: { a: 1 } },
    });
  });

  it('generate: references / refinement / story accept both omission and explicit null and are stored verbatim', async () => {
    const omitted = await postJson<RequestBody>('/api/v1/requests', generateBody(generatePayload()));
    expect(omitted.status).toBe(201);
    expect(omitted.body.payload).not.toHaveProperty('references');

    const withNulls = await postJson<RequestBody>(
      '/api/v1/requests',
      generateBody(generatePayload({ references: null, refinement: null, story: null })),
    );
    expect(withNulls.status).toBe(201);
    expect(withNulls.body.payload).toMatchObject({ references: null, refinement: null, story: null });
  });

  it('import: patch items keep keys beyond target / op / reason in patches_json', async () => {
    const patches = [
      { target: 'prompt.positive.expression', op: 'replace', reason: 'smile', value: 'smile', old: 'serious', future_key: { n: 1 } },
      { target: 'prompt.positive', op: 'append', reason: 'x' },
    ];
    const res = await postJson<RequestBody>('/api/v1/requests', importBody({ patches, pose_fingerprint: 'fp-1' }));
    expect(res.status).toBe(201);
    expect(JSON.parse((await resolutionRow(res.body.id)).patches_json!)).toEqual(patches);
  });

  it('import: parameters and payload objects are stored as sent', async () => {
    const parameters = { kind: 'hand-edit', nested: { a: [1, { b: null }] } };
    const payload = { schema_version: 1, request: { instruction: 'x' }, custom: { keep: true } };
    const res = await postJson<RequestBody>('/api/v1/requests', importBody({ parameters, payload }));
    expect(res.status).toBe(201);
    const row = await resolutionRow(res.body.id);
    expect(JSON.parse(row.parameters_json!)).toEqual(parameters);
    expect(JSON.parse(row.payload_json)).toEqual(payload);
  });
});

describe('createRequestSchema: unknown keys elsewhere', () => {
  it('top-level unknown keys are dropped: a resend that only adds one replays instead of conflicting', async () => {
    const body = importBody({ raw_instruction: 'hand edit' });
    const created = await postJson<RequestBody>('/api/v1/requests', body);
    expect(created.status).toBe(201);

    const resend = await postJson<RequestBody>('/api/v1/requests', { ...body, unknown_top_level: { a: 1 } });
    expect(resend.status).toBe(200);
    expect(resend.body.id).toBe(created.body.id);
  });

  it('payload envelopes of the non-generate kinds are strict, generate is not', async () => {
    const { generation } = await createGeneration();
    const strictKinds = [
      ['redraw', { generation_id: generation.id, options: { method: 'hires', hires: 2048 } }],
      ['deliver', { generation_id: generation.id, options: { keep_scene: true } }],
      ['dof', { generation_id: generation.id, options: { focus: [0.5, 0.5] } }],
      ['lighting', { generation_id: generation.id }],
      ['saturation', { generation_id: generation.id, options: { strength: 0.5 } }],
    ] as const;
    for (const [kind, payload] of strictKinds) {
      const ok = await postJson<RequestBody>('/api/v1/requests', { kind, payload, idempotency_key: crypto.randomUUID(), created_by: 'gui' });
      expect(ok.status, `${kind} baseline`).toBe(201);
      const bad = await postJson<ErrorBody>('/api/v1/requests', {
        kind,
        payload: { ...payload, unknown_key: 1 },
        idempotency_key: crypto.randomUUID(),
        created_by: 'gui',
      });
      expect(bad.status, `${kind} unknown payload key`).toBe(400);
      expect(bad.body.error.message, kind).toMatch(/^payload: /);
    }
  });

  it('strict option objects reject unknown keys with the payload path in the message', async () => {
    const { generation } = await createGeneration();
    const bad = await postJson<ErrorBody>('/api/v1/requests', {
      kind: 'deliver',
      payload: { generation_id: generation.id, options: { keep_scene: true, unknown_option: 1 } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
    expect(bad.body.error.message).toMatch(/^payload\.options: /);
  });
});

describe('createRequestSchema: omitted fields', () => {
  it('import with only the required fields stores NULL / 0 for every resolution column and a derived payload', async () => {
    const res = await postJson<RequestBody>('/api/v1/requests', importBody());
    expect(res.status).toBe(201);
    expect(res.body.recipe_ref).toBe('production');
    const row = await resolutionRow(res.body.id);
    expect(row).toMatchObject({
      recipe: null,
      raw_instruction: null,
      patches_json: null,
      pose_fingerprint: null,
      preset_versions_json: null,
      git_commit: null,
      git_dirty: 0,
    });
    expect(JSON.parse(row.parameters_json!)).toEqual({ kind: 'hand-edit' });
    expect(JSON.parse(row.payload_json)).toEqual({ schema_version: 1, request: { instruction: null } });
  });

  it('import: explicit null on the nullish fields is the same as omitting them', async () => {
    const omitted = await postJson<RequestBody>('/api/v1/requests', importBody());
    const nulls = await postJson<RequestBody>(
      '/api/v1/requests',
      importBody({
        recipe: null,
        raw_instruction: null,
        patches: null,
        pose_fingerprint: null,
        preset_versions: null,
        git_commit: null,
        git_dirty: null,
        references: null,
      }),
    );
    expect(nulls.status).toBe(201);
    expect(await resolutionRow(nulls.body.id)).toEqual(await resolutionRow(omitted.body.id));

    const refs = await env.DB.prepare('SELECT COUNT(*) AS n FROM request_references WHERE target_request_id = ?')
      .bind(nulls.body.id)
      .first<{ n: number }>();
    expect(refs!.n).toBe(0);
  });

  it('non-import kinds: status stays queued and recipe_ref falls back to the default when omitted', async () => {
    const res = await postJson<RequestBody>('/api/v1/requests', generateBody(generatePayload()));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'queued', recipe_ref: 'production' });

    const explicit = await postJson<RequestBody>('/api/v1/requests', { ...generateBody(generatePayload()), recipe_ref: 'dev/contract' });
    expect(explicit.body.recipe_ref).toBe('dev/contract');
  });
});

describe('validation_error body', () => {
  it('joins every issue as "path: message" with "; " under a 400 validation_error', async () => {
    const res = await postJson<ErrorBody>('/api/v1/requests', { kind: 'generate', created_by: 'nobody' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const parts = res.body.error.message.split('; ');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.map((p) => p.split(':')[0]).sort()).toEqual(['created_by', 'idempotency_key']);
  });

  it('uses "(root)" for an issue with an empty path', async () => {
    const res = await postJson<ErrorBody>('/api/v1/requests', []);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toMatch(/^\(root\): /);
  });

  it('carries refinement messages with the path they are attached to', async () => {
    const missingPayload = await postJson<ErrorBody>('/api/v1/requests', {
      kind: 'generate',
      idempotency_key: crypto.randomUUID(),
      created_by: 'brain',
    });
    expect(missingPayload.body).toEqual({ error: { code: 'validation_error', message: 'payload: payload is required' } });

    const importWithoutStatus = await postJson<ErrorBody>('/api/v1/requests', importBody({ status: undefined, parameters: undefined }));
    expect(importWithoutStatus.body).toEqual({
      error: {
        code: 'validation_error',
        message: "status: status must be 'done' for kind import; parameters: parameters is required for kind import",
      },
    });

    const foreignKey = await postJson<ErrorBody>('/api/v1/requests', { ...generateBody(generatePayload()), git_commit: 'abc' });
    expect(foreignKey.body).toEqual({ error: { code: 'validation_error', message: 'git_commit: git_commit is only accepted for kind import' } });

    const patchesWithoutFingerprint = await postJson<ErrorBody>(
      '/api/v1/requests',
      importBody({ patches: [{ target: 'prompt.positive', op: 'append', reason: 'x' }] }),
    );
    expect(patchesWithoutFingerprint.body).toEqual({
      error: { code: 'validation_error', message: 'pose_fingerprint: pose_fingerprint is required when patches is non-empty' },
    });
  });

  it('prefixes payload envelope issues with payload and their own path', async () => {
    const { generation } = await createGeneration();
    const res = await postJson<ErrorBody>('/api/v1/requests', {
      kind: 'dof',
      payload: { generation_id: generation.id, options: { focus: [0.5, 0.5], scope: { figure: false, outline: false, backdrop: false } } },
      idempotency_key: crypto.randomUUID(),
      created_by: 'gui',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('payload.options.scope: scope must keep at least one layer');
  });

});
