import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePatchGrammar, patchGrammarIssues } from '../src/lib/patch-grammar';
import { createGeneration, mcpToolCall, postJson } from './helpers';

// chagama が catalog に載せる `patches` ブロックと同じ形 (chagama src/chagama/application/catalog.py `_patches_block`)。
const GRAMMAR_BLOCK = {
  keys: ['target', 'op', 'value', 'old', 'reason'],
  text: {
    targets: ['prompt.positive', 'prompt.negative'],
    part_target: 'prompt.positive.<part>',
    ops: { append: ['value'], prepend: ['value'], replace: ['old', 'value'], remove: ['old'] },
  },
  number: {
    'render.cfg': { op: 'set', constraints: '> 0' },
    'render.width': { op: 'set', constraints: 'an int >= 64, a multiple of 8' },
  },
  string: { 'render.model': { op: 'set', values: null } },
  loras: { 'render.loras': { op: 'set' } },
  overrides: { 'render.steps': { op: 'set' } },
};

function uniqueRecipeRef(): string {
  return `test-${crypto.randomUUID()}`;
}

async function publish(recipeRef: string, patches: unknown = GRAMMAR_BLOCK): Promise<void> {
  const res = await postJson(`/api/v1/catalogs/${recipeRef}`, { schema_version: 3, recipes: [{ name: 'yukari', poses: [] }], patches }, 'PUT');
  expect(res.status).toBe(200);
}

/** 既定の recipe_ref (テストでは production) に載せたカタログは、他のテストへ漏れないよう毎回消す。 */
afterEach(async () => {
  await env.DB.prepare('DELETE FROM recipe_catalogs').run();
});

const REPLACE_EMPTY_VALUE = { target: 'prompt.positive.gesture', op: 'replace', old: 'waving', value: '', reason: 'r' };
const VALID_PATCHES = [
  { target: 'prompt.positive.expression', op: 'replace', old: 'smile', value: 'grin', reason: 'r' },
  { target: 'prompt.positive.gesture', op: 'append', value: 'waving', reason: 'r' },
  { target: 'prompt.negative', op: 'remove', old: 'blurry', reason: 'r' },
  { target: 'render.cfg', op: 'set', value: 5.5, reason: 'r' },
  { target: 'render.loras', op: 'set', value: [{ name: 'a', weight: 0.5 }], reason: 'r' },
];

const REPLACE_EMPTY_VALUE_TEXT = "must be a non-empty string (op 'replace' takes old and value); ops that take no value: remove";

// [label, patches, "path: message" (patches 配列からの相対)]
const REJECTED: [label: string, patches: unknown[], expected: string][] = [
  ['replace with an empty value', [REPLACE_EMPTY_VALUE], `0.value: ${REPLACE_EMPTY_VALUE_TEXT}`],
  ['replace without value', [{ target: 'prompt.positive.gesture', op: 'replace', old: 'x', reason: 'r' }], `0.value: ${REPLACE_EMPTY_VALUE_TEXT}`],
  ['replace without old', [{ target: 'prompt.positive.gesture', op: 'replace', value: 'x', reason: 'r' }], "0.old: must be a non-empty string (op 'replace' takes old and value); ops that take no old: append, prepend"],
  ['append without value', [{ target: 'prompt.positive', op: 'append', reason: 'r' }], "0.value: must be a non-empty string (op 'append' takes value)"],
  ['remove with value', [{ target: 'prompt.positive.gesture', op: 'remove', old: 'x', value: 'y', reason: 'r' }], "0.value: op 'remove' does not take value"],
  ['append with old', [{ target: 'prompt.positive.gesture', op: 'append', value: 'x', old: 'y', reason: 'r' }], "0.old: op 'append' does not take old"],
  ['unknown key', [{ target: 'prompt.positive.gesture', op: 'append', value: 'x', reason: 'r', note: 'n' }], '0.note: unknown patch key; allowed: target, op, value, old, reason'],
  ['set op on a text target', [{ target: 'prompt.positive.gesture', op: 'set', value: 'x', reason: 'r' }], "0.op: op 'set' is not valid for prompt.positive.gesture; use one of append, prepend, replace, remove"],
  ['text op on a number target', [{ target: 'render.cfg', op: 'append', value: 'x', reason: 'r' }], "0.op: op 'append' is not valid for render.cfg; use set"],
  ['number target without value', [{ target: 'render.cfg', op: 'set', reason: 'r' }], "0.value: required for op 'set'"],
  ['string target with an empty value', [{ target: 'render.model', op: 'set', value: '', reason: 'r' }], "0.value: required for op 'set'"],
  ['loras target with an empty list', [{ target: 'render.loras', op: 'set', value: [], reason: 'r' }], "0.value: required for op 'set'"],
  ['number target with a null value', [{ target: 'render.width', op: 'set', value: null, reason: 'r' }], "0.value: required for op 'set'"],
  ['the second patch only', [VALID_PATCHES[0], { target: 'render.cfg', op: 'set', reason: 'r' }], "1.value: required for op 'set'"],
];

const ACCEPTED: [label: string, patches: unknown[]][] = [
  ['valid text, number and loras patches', VALID_PATCHES],
  ['a target outside every class', [{ target: 'render.foo', op: 'whatever', value: '', reason: 'r' }]],
  ['a part name containing a dot', [{ target: 'prompt.positive.a.b', op: 'whatever', reason: 'r' }]],
  ['a target listed only under overrides', [{ target: 'render.steps', op: 'append', reason: 'r' }]],
  ['no patches', []],
];

function generateBody(recipeRef: string | undefined, patches: unknown) {
  return {
    kind: 'generate',
    payload: {
      schema_version: 1,
      request: { instruction: 'i', count: 1 },
      generation: { recipe: 'yukari', parameters: { pose: 'lounge' }, ...(patches === undefined ? {} : { patches }) },
    },
    ...(recipeRef ? { recipe_ref: recipeRef } : {}),
    idempotency_key: crypto.randomUUID(),
    created_by: 'brain',
  };
}

async function postGenerate(recipeRef: string | undefined, patches: unknown) {
  const res = await postJson<{ error?: { code: string; message: string } }>('/api/v1/requests', generateBody(recipeRef, patches));
  return { status: res.status, message: res.body.error?.message, code: res.body.error?.code };
}

async function count(table: string, where: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...binds).first<{ n: number }>();
  return row!.n;
}

describe('POST /api/v1/requests (kind=generate)', () => {
  it.each(REJECTED)('rejects %s with a 400 naming the field', async (_label, patches, expected) => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const res = await postGenerate(ref, patches);
    expect(res).toEqual({ status: 400, code: 'validation_error', message: `payload.generation.patches.${expected}` });
  });

  it.each(ACCEPTED)('accepts %s', async (_label, patches) => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    expect((await postGenerate(ref, patches)).status).toBe(201);
  });

  it('accepts a request without generation.patches', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    expect((await postGenerate(ref, undefined)).status).toBe(201);
  });

  it('reports every violation in one message', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const res = await postGenerate(ref, [{ target: 'prompt.positive.gesture', op: 'remove', old: 'x', value: 'y' }, { target: 'render.cfg', op: 'set' }]);
    expect(res.message).toBe(
      [
        'payload.generation.patches.0.reason: must be a non-empty string',
        'payload.generation.patches.1.reason: must be a non-empty string',
        "payload.generation.patches.0.value: op 'remove' does not take value",
        "payload.generation.patches.1.value: required for op 'set'",
      ].join('; '),
    );
  });

  it('rejects patches that are not an array', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const res = await postGenerate(ref, 'x');
    expect(res.status).toBe(400);
    expect(res.message).toBe('payload.generation.patches: must be an array of patch objects, e.g. [{ target, op, reason, value? }]');
  });

  it('checks against the catalog of the request recipe_ref', async () => {
    const strict = uniqueRecipeRef();
    const other = uniqueRecipeRef();
    await publish(strict);
    await publish(other, { pose: { op: 'set' } });
    expect((await postGenerate(strict, [REPLACE_EMPTY_VALUE])).status).toBe(400);
    expect((await postGenerate(other, [REPLACE_EMPTY_VALUE])).status).toBe(201);
  });

  it('uses the catalog of the default recipe_ref when recipe_ref is omitted', async () => {
    await publish('production');
    const res = await postGenerate(undefined, [REPLACE_EMPTY_VALUE]);
    expect(res.status).toBe(400);
    expect(res.message).toBe(`payload.generation.patches.0.value: ${REPLACE_EMPTY_VALUE_TEXT}`);
    expect((await postGenerate(undefined, VALID_PATCHES)).status).toBe(201);
  });

  it('does not check anything when no catalog is published for the recipe_ref', async () => {
    expect((await postGenerate(uniqueRecipeRef(), [REPLACE_EMPTY_VALUE])).status).toBe(201);
    expect((await postGenerate(undefined, [REPLACE_EMPTY_VALUE])).status).toBe(201);
  });

  it.each([
    ['an old-style block', { pose: { op: 'set' }, costume: { op: 'set' } }],
    ['an empty block', {}],
    ['a block without text.ops', { keys: ['target', 'op'], text: { targets: ['prompt.positive'] } }],
    ['a block whose keys is not a list', { keys: 'target', text: { ops: { append: ['value'] } } }],
  ])('does not check anything against %s', async (_label, block) => {
    const ref = uniqueRecipeRef();
    await publish(ref, block);
    expect((await postGenerate(ref, [REPLACE_EMPTY_VALUE])).status).toBe(201);
  });

  it('replays an accepted request with 200 even after the catalog started rejecting its patches', async () => {
    const ref = uniqueRecipeRef();
    const body = generateBody(ref, [REPLACE_EMPTY_VALUE]);
    const first = await postJson<{ id: string }>('/api/v1/requests', body);
    expect(first.status).toBe(201);
    await publish(ref);

    const replay = await postJson<{ id: string }>('/api/v1/requests', body);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);

    // 別の内容で同じキーを使えば、検査の前に 409 になる。
    const conflicting = await postJson<{ error: { code: string } }>('/api/v1/requests', {
      ...body,
      payload: { ...body.payload, request: { instruction: 'other', count: 1 } },
    });
    expect(conflicting.status).toBe(409);

    // 新しいキーなら検査される。
    expect((await postJson('/api/v1/requests', { ...body, idempotency_key: crypto.randomUUID() })).status).toBe(400);
  });

  it('does not check the patches a reroll carries over from the original', async () => {
    await publish('production');
    const payload = {
      schema_version: 1,
      request: { instruction: 'i', count: 1 },
      generation: { recipe: 'yukari', parameters: { pose: 'lounge' }, patches: [REPLACE_EMPTY_VALUE] },
    };
    const { generation } = await createGeneration({ requestOverrides: { recipe: 'yukari', payload } });
    const res = await postJson<{ rounds: unknown[] }>(`/api/v1/generations/${generation.id}/reroll`, {});
    expect(res.status).toBe(201);
    expect(res.body.rounds).toHaveLength(1);
  });
});

describe('MCP create_request (kind=generate)', () => {
  it('rejects a grammar violation as a tool error and queues nothing', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const key = crypto.randomUUID();
    const call = await mcpToolCall('create_request', {
      kind: 'generate',
      payload: generateBody(ref, [REPLACE_EMPTY_VALUE]).payload,
      recipe_ref: ref,
      idempotency_key: key,
    });
    expect(call.isError).toBe(true);
    expect(call.text).toBe(`payload.generation.patches.0.value: ${REPLACE_EMPTY_VALUE_TEXT}`);
    expect(await count('requests', 'idempotency_key = ?', key)).toBe(0);
  });

  it('replays an accepted call as created=false even after the catalog started rejecting its patches', async () => {
    const ref = uniqueRecipeRef();
    const input = { kind: 'generate', payload: generateBody(ref, [REPLACE_EMPTY_VALUE]).payload, recipe_ref: ref, idempotency_key: crypto.randomUUID() };
    const first = await mcpToolCall<{ created: boolean; request: { id: string } }>('create_request', input);
    expect(first.data?.created).toBe(true);
    await publish(ref);

    const replay = await mcpToolCall<{ created: boolean; request: { id: string } }>('create_request', input);
    expect(replay.isError).toBe(false);
    expect(replay.data?.created).toBe(false);
    expect(replay.data?.request.id).toBe(first.data?.request.id);

    expect((await mcpToolCall('create_request', { ...input, idempotency_key: crypto.randomUUID() })).isError).toBe(true);
  });

  it('uses the default recipe_ref and accepts valid patches', async () => {
    await publish('production');
    const payload = (patches: unknown) => generateBody(undefined, patches).payload;
    const bad = await mcpToolCall('create_request', { kind: 'generate', payload: payload([REPLACE_EMPTY_VALUE]), idempotency_key: crypto.randomUUID() });
    expect(bad.isError).toBe(true);
    const good = await mcpToolCall<{ created: boolean }>('create_request', { kind: 'generate', payload: payload(VALID_PATCHES), idempotency_key: crypto.randomUUID() });
    expect(good.isError).toBe(false);
    expect(good.data?.created).toBe(true);
  });

  it('accepts anything when no catalog is published', async () => {
    const call = await mcpToolCall('create_request', {
      kind: 'generate',
      payload: generateBody(undefined, [REPLACE_EMPTY_VALUE]).payload,
      recipe_ref: uniqueRecipeRef(),
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(false);
  });
});

describe('MCP derive_request', () => {
  async function createParent() {
    // 親の patches は文法に反するが、引き継ぐだけなので検査しない。
    return createGeneration({
      requestOverrides: { recipe: 'yukari', parameters: { pose: 'lounge' }, patches: [REPLACE_EMPTY_VALUE], pose_fingerprint: 'sha256:fixture' },
    });
  }

  const derive = (generationId: string, ref: string, patches: unknown, key = crypto.randomUUID()) =>
    mcpToolCall<{ payload: { generation: { patches: unknown[] } } }>('derive_request', {
      from_generation_id: generationId,
      instruction: 'variant',
      count: 1,
      patches,
      semantic: { summary: 'variant' },
      recipe_ref: ref,
      idempotency_key: key,
    });

  it('rejects an invalid patch the caller passes, and queues nothing', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await createParent();
    const key = crypto.randomUUID();
    const call = await derive(generation.id, ref, [{ target: 'prompt.positive.gesture', op: 'remove', old: 'x', value: 'y', reason: 'r' }], key);
    expect(call.isError).toBe(true);
    expect(call.text).toBe("patches.0.value: op 'remove' does not take value");
    expect(await count('requests', 'idempotency_key = ?', key)).toBe(0);
  });

  it('does not re-check the parent patches it carries forward', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await createParent();
    const call = await derive(generation.id, ref, [{ target: 'render.cfg', op: 'set', value: 6, reason: 'r' }]);
    expect(call.isError).toBe(false);
    expect(call.data?.payload.generation.patches).toEqual([REPLACE_EMPTY_VALUE, { target: 'render.cfg', op: 'set', value: 6, reason: 'r' }]);
  });

  it('replays an accepted call as created=false even after the catalog started rejecting its patches', async () => {
    const ref = uniqueRecipeRef();
    const { generation } = await createParent();
    const patches = [{ target: 'prompt.positive.gesture', op: 'remove', old: 'x', value: 'y', reason: 'r' }];
    const key = crypto.randomUUID();
    const first = await mcpToolCall<{ created: boolean; request: { id: string } }>('derive_request', {
      from_generation_id: generation.id,
      instruction: 'variant',
      count: 1,
      patches,
      semantic: { summary: 'variant' },
      recipe_ref: ref,
      idempotency_key: key,
    });
    expect(first.data?.created).toBe(true);
    await publish(ref);

    const replay = await derive(generation.id, ref, patches, key);
    expect(replay.isError).toBe(false);
    expect((replay.data as unknown as { created: boolean; request: { id: string } }).created).toBe(false);
    expect((replay.data as unknown as { request: { id: string } }).request.id).toBe(first.data?.request.id);

    expect((await derive(generation.id, ref, patches)).isError).toBe(true);
  });

  it('does not check a derive without patches, even when the parent patches are invalid', async () => {
    const ref = uniqueRecipeRef();
    await publish(ref);
    const { generation } = await createParent();
    expect((await derive(generation.id, ref, undefined)).isError).toBe(false);
  });

  it('checks against the default recipe_ref when recipe_ref is omitted', async () => {
    await publish('production');
    const { generation } = await createParent();
    const call = await mcpToolCall('derive_request', {
      from_generation_id: generation.id,
      instruction: 'variant',
      count: 1,
      patches: [{ target: 'render.cfg', op: 'set', reason: 'r' }],
      semantic: { summary: 'variant' },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toBe("patches.0.value: required for op 'set'");
  });
});

describe('MCP create_experiment', () => {
  const experimentInput = (arms: unknown[], extra: Record<string, unknown> = {}) => ({
    name: `exp-${crypto.randomUUID().slice(0, 8)}`,
    recipe: 'yukari',
    parameters: { pose: 'lounge' },
    seeds: [1, 2],
    arms,
    idempotency_key: crypto.randomUUID(),
    ...extra,
  });

  it('rejects an invalid arm before creating anything', async () => {
    await publish('production');
    const input = experimentInput([{ label: 'control' }, { label: 'ok', patches: [VALID_PATCHES[0]] }, { label: 'bad', patches: [REPLACE_EMPTY_VALUE] }]);
    const runRequestsBefore = await count('requests', 'run_id IS NOT NULL');
    const call = await mcpToolCall('create_experiment', input);
    expect(call.isError).toBe(true);
    expect(call.text).toBe(`arms.2.patches.0.value: ${REPLACE_EMPTY_VALUE_TEXT}`);
    expect(await count('experiments', 'name = ?', input.name)).toBe(0);
    expect(await count('experiment_runs', 'idempotency_key LIKE ?', `${input.idempotency_key}:arm:%`)).toBe(0);
    expect(await count('requests', 'run_id IS NOT NULL')).toBe(runRequestsBefore);
  });

  it('reports the violations of every arm together', async () => {
    await publish('production');
    const call = await mcpToolCall(
      'create_experiment',
      experimentInput([
        { label: 'a', patches: [REPLACE_EMPTY_VALUE] },
        { label: 'b', patches: [{ target: 'render.cfg', op: 'set', reason: 'r' }] },
      ]),
    );
    expect(call.text).toBe(`arms.0.patches.0.value: ${REPLACE_EMPTY_VALUE_TEXT}; arms.1.patches.0.value: required for op 'set'`);
  });

  it('creates the Experiment when every arm is valid', async () => {
    await publish('production');
    const call = await mcpToolCall<{ created: boolean; runs: unknown[] }>('create_experiment', experimentInput([{ label: 'control' }, { label: 'v', patches: VALID_PATCHES }]));
    expect(call.isError).toBe(false);
    expect(call.data?.created).toBe(true);
    expect(call.data?.runs).toHaveLength(2);
  });

  it('accepts anything when no catalog is published', async () => {
    const call = await mcpToolCall('create_experiment', experimentInput([{ label: 'bad', patches: [REPLACE_EMPTY_VALUE] }]));
    expect(call.isError).toBe(false);
  });

  it('replays an earlier call as created=false even after the catalog started rejecting its patches', async () => {
    const input = experimentInput([{ label: 'control' }, { label: 'bad', patches: [REPLACE_EMPTY_VALUE] }]);
    const first = await mcpToolCall<{ created: boolean; experiment: { id: string } }>('create_experiment', input);
    expect(first.data?.created).toBe(true);

    await publish('production');
    const replay = await mcpToolCall<{ created: boolean; experiment: { id: string } }>('create_experiment', input);
    expect(replay.isError).toBe(false);
    expect(replay.data?.created).toBe(false);
    expect(replay.data?.experiment.id).toBe(first.data?.experiment.id);

    // 別の内容で同じキーを使えば、検査の前に 409 になる。
    const conflicting = await mcpToolCall('create_experiment', { ...input, arms: [{ label: 'other', patches: [REPLACE_EMPTY_VALUE] }] });
    expect(conflicting.isError).toBe(true);
    expect(conflicting.text).toContain('already used for a different set of arms');
  });
});

describe('Experiment Run creation', () => {
  async function createExperiment(): Promise<string> {
    const res = await postJson<{ id: string }>('/api/v1/experiments', {
      name: `exp-${crypto.randomUUID().slice(0, 8)}`,
      base_recipe: 'yukari',
      base_parameters: { pose: 'lounge' },
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  const EXPECTED = `overrides.patches.0.value: ${REPLACE_EMPTY_VALUE_TEXT}`;

  it('POST /api/v1/experiments/{id}/runs rejects an invalid overrides.patches and creates no Run', async () => {
    await publish('production');
    const experimentId = await createExperiment();
    const runRequestsBefore = await count('requests', 'run_id IS NOT NULL');
    const res = await postJson<{ error?: { code: string; message: string } }>(`/api/v1/experiments/${experimentId}/runs`, {
      overrides: { patches: [REPLACE_EMPTY_VALUE] },
      idempotency_key: crypto.randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: 'validation_error', message: EXPECTED });
    expect(await count('experiment_runs', 'experiment_id = ?', experimentId)).toBe(0);
    expect(await count('requests', 'run_id IS NOT NULL')).toBe(runRequestsBefore);
  });

  it('POST /api/v1/experiments/{id}/runs accepts valid patches', async () => {
    await publish('production');
    const experimentId = await createExperiment();
    const res = await postJson(`/api/v1/experiments/${experimentId}/runs`, { overrides: { patches: VALID_PATCHES }, idempotency_key: crypto.randomUUID() });
    expect(res.status).toBe(201);
  });

  it('MCP create_run rejects an invalid overrides.patches and creates no Run', async () => {
    await publish('production');
    const experimentId = await createExperiment();
    const call = await mcpToolCall('create_run', {
      experiment_id: experimentId,
      overrides: { patches: [REPLACE_EMPTY_VALUE] },
      idempotency_key: crypto.randomUUID(),
    });
    expect(call.isError).toBe(true);
    expect(call.text).toBe(EXPECTED);
    expect(await count('experiment_runs', 'experiment_id = ?', experimentId)).toBe(0);
  });

  it('accepts anything when no catalog is published', async () => {
    const experimentId = await createExperiment();
    const res = await postJson(`/api/v1/experiments/${experimentId}/runs`, { overrides: { patches: [REPLACE_EMPTY_VALUE] }, idempotency_key: crypto.randomUUID() });
    expect(res.status).toBe(201);
  });

  it('replays an accepted Run even after the catalog started rejecting its patches', async () => {
    const experimentId = await createExperiment();
    const body = { overrides: { patches: [REPLACE_EMPTY_VALUE] }, idempotency_key: crypto.randomUUID() };
    expect((await postJson(`/api/v1/experiments/${experimentId}/runs`, body)).status).toBe(201);
    await publish('production');
    expect((await postJson(`/api/v1/experiments/${experimentId}/runs`, body)).status).toBe(200);
    const newKey = await postJson(`/api/v1/experiments/${experimentId}/runs`, { ...body, idempotency_key: crypto.randomUUID() });
    expect(newKey.status).toBe(400);
  });
});

describe('parsePatchGrammar / patchGrammarIssues', () => {
  const grammar = parsePatchGrammar(GRAMMAR_BLOCK)!;

  it('parses the published block, ignoring unrelated keys', () => {
    expect(grammar.keys).toEqual(['target', 'op', 'value', 'old', 'reason']);
    expect([...grammar.textOps]).toEqual([
      ['append', ['value']],
      ['prepend', ['value']],
      ['replace', ['old', 'value']],
      ['remove', ['old']],
    ]);
    expect([...grammar.setOps]).toEqual([
      ['render.cfg', 'set'],
      ['render.width', 'set'],
      ['render.model', 'set'],
      ['render.loras', 'set'],
    ]);
  });

  it.each([null, undefined, 'x', [], {}, { pose: { op: 'set' } }, { keys: [], text: {} }])('returns null for %j', (block) => {
    expect(parsePatchGrammar(block)).toBeNull();
  });

  it('takes the rules from the table, not from the op names', () => {
    const custom = parsePatchGrammar({
      keys: ['target', 'op', 'value', 'reason'],
      text: { targets: ['prompt.positive'], ops: { swap: ['value'] } },
    })!;
    expect(patchGrammarIssues(custom, [{ target: 'prompt.positive', op: 'swap', reason: 'r' }], [])).toEqual([
      { path: [0, 'value'], message: "must be a non-empty string (op 'swap' takes value)" },
    ]);
    expect(patchGrammarIssues(custom, [{ target: 'prompt.positive', op: 'append', value: 'x', reason: 'r' }], [])).toEqual([
      { path: [0, 'op'], message: "op 'append' is not valid for prompt.positive; use swap" },
    ]);
  });

  it('suggests the ops whose keys are the current op keys minus the missing one', () => {
    const custom = parsePatchGrammar({
      keys: ['target', 'op', 'value', 'old', 'reason'],
      text: { targets: ['prompt.positive'], ops: { put: ['old', 'value'], drop: ['old'], add: ['value'], fill: ['value'], wipe: [] } },
    })!;
    const put = (fields: Record<string, unknown>) => patchGrammarIssues(custom, [{ target: 'prompt.positive', op: 'put', reason: 'r', ...fields }], []);
    expect(put({ old: 'a' })).toEqual([{ path: [0, 'value'], message: "must be a non-empty string (op 'put' takes old and value); ops that take no value: drop" }]);
    expect(put({ value: 'a' })).toEqual([{ path: [0, 'old'], message: "must be a non-empty string (op 'put' takes old and value); ops that take no old: add, fill" }]);
    const add = patchGrammarIssues(custom, [{ target: 'prompt.positive', op: 'add', reason: 'r' }], []);
    expect(add).toEqual([{ path: [0, 'value'], message: "must be a non-empty string (op 'add' takes value); ops that take no value: wipe" }]);
  });

  it('treats a part_target-less grammar as having no per-part class', () => {
    const noParts = parsePatchGrammar({ keys: ['target', 'op', 'value', 'old', 'reason'], text: { targets: ['prompt.positive'], ops: { append: ['value'] } } })!;
    expect(patchGrammarIssues(noParts, [{ target: 'prompt.positive.gesture', op: 'set', reason: 'r' }], [])).toEqual([]);
  });
});
