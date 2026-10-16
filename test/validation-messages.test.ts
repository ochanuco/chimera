// 400 / tool error に載る検証メッセージと path を固定する。検証ライブラリや refinement の置き場所を変えても
// 受理・拒否と本文が変わらないことの確認用 (REST は `{ error: { code, message } }`、MCP は SDK が包む tool error)。
import { describe, expect, it } from 'vitest';
import { mcpCall, postJson } from './helpers';

type Method = 'POST' | 'PATCH' | 'PUT';

const MISSING_ID = 'missing-id';

const optionsPayload = (options: unknown) => ({ generation_id: MISSING_ID, options });

const requestCase = (kind: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
  kind,
  payload,
  idempotency_key: 'k',
  created_by: 'gui',
  ...extra,
});

const REST_CASES: [label: string, method: Method, path: string, body: unknown][] = [
  ['resolution: patches without pose_fingerprint', 'PUT', '/api/v1/requests/x/resolution', { parameters: {}, patches: [{ target: 'a', op: 'b', reason: 'c' }] }],
  ['resolution: reference without source id', 'PUT', '/api/v1/requests/x/resolution', { parameters: {}, references: [{ purpose: 'p' }] }],
  ['resolution: patch missing reason', 'PUT', '/api/v1/requests/x/resolution', { parameters: {}, patches: [{ target: 'a', op: 'b' }] }],
  ['request update: running without worker_id', 'PATCH', '/api/v1/requests/x', { status: 'running' }],
  ['request update: failed without worker_id and error', 'PATCH', '/api/v1/requests/x', { status: 'failed' }],
  ['request update: done without result', 'PATCH', '/api/v1/requests/x', { status: 'done', worker_id: 'w' }],
  ['request create: finalize', 'POST', '/api/v1/requests', requestCase('finalize', { generation_id: MISSING_ID })],
  ['request create: run_id on generate', 'POST', '/api/v1/requests', requestCase('generate', { schema_version: 1, request: {}, generation: {} }, { run_id: 'r' })],
  ['request create: resolution keys on generate', 'POST', '/api/v1/requests', requestCase('generate', { schema_version: 1, request: {}, generation: {} }, { recipe: 'r', patches: [], parameters: {} })],
  ['request create: generate payload without generation', 'POST', '/api/v1/requests', requestCase('generate', { schema_version: 1, request: {} })],
  ['request create: dof scope with no layer', 'POST', '/api/v1/requests', requestCase('dof', optionsPayload({ focus: [0.5, 0.5], scope: { figure: false, outline: false, backdrop: false } }))],
  ['request create: lens radius without sphere', 'POST', '/api/v1/requests', requestCase('lens', optionsPayload({ radius: 0.5 }))],
  ['request create: lens strength 0', 'POST', '/api/v1/requests', requestCase('lens', optionsPayload({ strength: 0 }))],
  ['request create: stage place without photo', 'POST', '/api/v1/requests', requestCase('stage', optionsPayload({ place: [0.5, 0.5] }))],
  ['request create: stage photo with backdrop', 'POST', '/api/v1/requests', requestCase('stage', optionsPayload({ photo: 'p', backdrop: 'dots', shadow_from: 'n' }))],
  ['request create: repair', 'POST', '/api/v1/requests', requestCase('repair', optionsPayload({ parts: ['hands'] }))],
  ['request create: redraw method missing', 'POST', '/api/v1/requests', requestCase('redraw', optionsPayload({ denoise: 0.5 }))],
  ['request create: deliver outlines over the limit', 'POST', '/api/v1/requests', requestCase('deliver', optionsPayload({ outlines: Array.from({ length: 7 }, () => ({ color: '#ffffff', width: 1 })) }))],
  ['request create: bad recipe_ref', 'POST', '/api/v1/requests', requestCase('lighting', { generation_id: MISSING_ID }, { recipe_ref: '-bad' })],
  ['request claim: empty kinds', 'POST', '/api/v1/requests/claim', { worker_id: 'w', kinds: [] }],
  ['request claim: import is not claimable', 'POST', '/api/v1/requests/claim', { worker_id: 'w', kinds: ['import'] }],
  ['experiment create: non-integer seeds', 'POST', '/api/v1/experiments', { name: 'n', base_parameters: { seeds: [1.5] } }],
  ['experiment create: seeds and count disagree', 'POST', '/api/v1/experiments', { name: 'n', base_parameters: { seeds: [1, 2], count: 3 } }],
  ['experiment update: no fields', 'PATCH', '/api/v1/experiments/x', {}],
  ['experiment update: bad status', 'PATCH', '/api/v1/experiments/x', { status: 'nope' }],
  ['run create: unexpected overrides key', 'POST', '/api/v1/experiments/x/runs', { overrides: { pose: 'a', count: 1 } }],
  ['run create: patches is not an array', 'POST', '/api/v1/experiments/x/runs', { overrides: { patches: 'x' } }],
  ['run create: patches entries', 'POST', '/api/v1/experiments/x/runs', { overrides: { patches: [1, { target: 'a' }, [], { target: 'a', op: '', reason: 3 }] } }],
  ['run create: batch_id', 'POST', '/api/v1/experiments/x/runs', { batch_id: 'b' }],
  ['run create: variables with a boolean', 'POST', '/api/v1/experiments/x/runs', { variables: { a: true } }],
  ['run update: no fields', 'PATCH', '/api/v1/experiment-runs/x', {}],
  ['run update: batch_id with other fields', 'PATCH', '/api/v1/experiment-runs/x', { batch_id: null, note: 'n' }],
  ['promotion create: javascript url', 'POST', '/api/v1/experiments/x/promotions', { pull_request_url: 'javascript:alert(1)' }],
  ['promotion create: not a url', 'POST', '/api/v1/experiments/x/promotions', { pull_request_url: 'nope' }],
  ['promotion update: no fields', 'PATCH', '/api/v1/promotions/x', {}],
  ['judgment: bad verdict', 'POST', '/api/v1/experiments/x/judgments', { baseline_run_id: 'a', arm_run_id: 'b', seed: 1, left_generation_id: 'l', right_generation_id: 'r', verdict: 'both' }],
  ['generation update: no fields', 'PATCH', '/api/v1/generations/x', {}],
  ['generation rating: bad value', 'PUT', '/api/v1/generations/x/rating', { rating: 'great' }],
  ['generation semantic: missing schema_version', 'PUT', '/api/v1/generations/x/semantic', { summary: 's', core: { pose: 1 } }],
  ['generation safety: probability over 1', 'PUT', '/api/v1/generations/x/safety', { model: 'm', rating: { general: 2, sensitive: 0, questionable: 0, explicit: 0 }, tags: { a: -1 } }],
  ['publication create: http url', 'POST', '/api/v1/generations/x/publications', { url: 'http://example.com/a' }],
  ['publication create: unparsable https url', 'POST', '/api/v1/generations/x/publications', { url: 'https://' }],
  ['publication update: missing url', 'PATCH', '/api/v1/publications/x', {}],
  ['observation: neither pose nor component', 'POST', '/api/v1/observations', { character: 'c', parameter: 'p', value: 'v', outcome: 'accepted', reason: 'r', idempotency_key: 'k' }],
  ['observation sync: records shape', 'POST', '/api/v1/observations/sync', { files: [{ path: 'p', records: [{ line: 0 }] }] }],
  ['workbench: unknown phase key', 'PUT', '/api/v1/workbenches/x', { picks: { '7': { skip: true }, '0': { skip: true }, '1': { skip: true } } }],
  ['workbench: malformed picks', 'PUT', '/api/v1/workbenches/x', { picks: { '1': { generation_id: '' }, '2': { skip: true, generation_id: 'g' } } }],
  ['workbench: extra top-level key', 'PUT', '/api/v1/workbenches/x', { picks: {}, extra: 1 }],
  ['job update: no fields', 'PATCH', '/api/v1/jobs/x', {}],
  ['job create: negative index', 'POST', '/api/v1/requests/x/jobs', { idempotency_key: 'k', seed: 1.5, index: -1 }],
  ['preset promote: bad kind', 'POST', '/api/v1/presets/promote', { generation_id: 'g', name: 'n', kind: 'bad', idempotency_key: 'k' }],
  ['preset import: bad recipe_ref', 'POST', '/api/v1/presets/import', { recipe_ref: '-bad' }],
  ['timings put: bad prompt', 'PUT', '/api/v1/requests/x/timings', { worker_id: 'w', attempt: -1, version: 'v3', source: 'worker', status: 'done', prompts: [{ prompt_id: 'p', purpose: 'r', status: 'bad', nodes: [{ node_id: '1' }] }] }],
  ['catalog put: envelope', 'PUT', '/api/v1/catalogs/production', { schema_version: 4, recipes: [{ name: 1 }], patches: [] }],
  ['character create: empty name', 'POST', '/api/v1/characters', { name: '' }],
  ['tag rename: empty name', 'PATCH', '/api/v1/tags/x', { name: '' }],
];

const MCP_CASES: [label: string, tool: string, args: Record<string, unknown>][] = [
  ['create_experiment: duplicate arm labels', 'create_experiment', { name: 'n', recipe: 'r', arms: [{ label: 'a' }, { label: 'b' }, { label: 'a' }], idempotency_key: 'k' }],
  ['create_experiment: seeds and count disagree', 'create_experiment', { name: 'n', recipe: 'r', parameters: { count: 3 }, seeds: [1, 2], arms: [{ label: 'a' }], idempotency_key: 'k' }],
  ['create_experiment: parameters.seeds invalid', 'create_experiment', { name: 'n', recipe: 'r', parameters: { seeds: ['x'] }, arms: [{ label: 'a' }], idempotency_key: 'k' }],
  ['create_experiment: patch without reason', 'create_experiment', { name: 'n', recipe: 'r', arms: [{ label: 'a', patches: [{ target: 't', op: 'o' }] }], idempotency_key: 'k' }],
  ['create_run: bad variables', 'create_run', { experiment_id: 'e', variables: { a: [] }, idempotency_key: 'k' }],
  ['create_request: finalize kind', 'create_request', { kind: 'finalize', payload: {}, idempotency_key: 'k' }],
  ['create_request: invalid deliver envelope', 'create_request', { kind: 'deliver', payload: { generation_id: 'g', options: { stroke_light: 'x' }, extra: 1 }, idempotency_key: 'k' }],
  ['create_request: bad recipe_ref', 'create_request', { kind: 'generate', payload: { schema_version: 1, request: {}, generation: {} }, recipe_ref: '-bad', idempotency_key: 'k' }],
  ['derive_request: seeds length', 'derive_request', { from_generation_id: 'g', instruction: 'i', count: 2, seeds: [1], semantic: { summary: 's' }, idempotency_key: 'k' }],
  ['derive_request: empty patches reason', 'derive_request', { from_generation_id: 'g', instruction: 'i', semantic: { summary: 's' }, patches: [{ target: 't', op: 'o', reason: '' }], idempotency_key: 'k' }],
  ['redraw_generation: hires without method fields', 'redraw_generation', { generation_id: 'g', options: { method: 'hires', hires: 10 }, idempotency_key: 'k' }],
  ['dof_generation: scope with no layer', 'dof_generation', { generation_id: 'g', focus: [0.5, 0.5], scope: { figure: false, outline: false, backdrop: false }, idempotency_key: 'k' }],
  ['lens_generation: radius without sphere', 'lens_generation', { generation_id: 'g', radius: 0.5, idempotency_key: 'k' }],
  ['lens_generation: strength 0', 'lens_generation', { generation_id: 'g', strength: 0, idempotency_key: 'k' }],
  ['stage_generation: place without photo', 'stage_generation', { generation_id: 'g', place: [0.5, 0.5], idempotency_key: 'k' }],
  ['stage_generation: photo with backdrop', 'stage_generation', { generation_id: 'g', photo: 'p', backdrop: 'dots', idempotency_key: 'k' }],
  ['photo_generation: missing photo', 'photo_generation', { generation_id: 'g', idempotency_key: 'k' }],
  ['lighting_generation: bad direction', 'lighting_generation', { generation_id: 'g', direction: 'up', idempotency_key: 'k' }],
  ['deliver_generation: profile without name', 'deliver_generation', { generation_id: 'g', profile: { version: 0 }, idempotency_key: 'k' }],
  ['list_requests: bad status', 'list_requests', { status: 'nope' }],
  ['list_generations: bad limit', 'list_generations', { limit: 0 }],
  ['get_generation_lineage: depth over 10', 'get_generation_lineage', { generation_id: 'g', depth: 11 }],
  ['list_catalog: bad recipe_ref', 'list_catalog', { recipe_ref: '-bad' }],
  ['list_presets: bad kind', 'list_presets', { kind: 'nope' }],
  ['promote_to_pose: bad kind', 'promote_to_pose', { generation_id: 'g', name: 'n', kind: 'nope', idempotency_key: 'k' }],
  ['record_observation: neither pose nor component', 'record_observation', { character: 'c', parameter: 'p', value: 'v', outcome: 'accepted', reason: 'r', idempotency_key: 'k' }],
  ['record_observation: bad outcome', 'record_observation', { character: 'c', parameter: 'p', value: 'v', outcome: 'maybe', reason: 'r', idempotency_key: 'k' }],
  ['record_publication: http url', 'record_publication', { generation_id: 'g', url: 'http://example.com' }],
  ['set_evaluation: array evaluation', 'set_evaluation', { run_id: 'r', evaluation: [] }],
  ['plain_render: fractional seed', 'plain_render', { recipe: 'r', pose: 'p', seed: 1.5 }],
];

async function restOutcome(method: Method, path: string, body: unknown): Promise<string> {
  const res = await postJson<{ error?: { code: string; message: string } }>(path, body, method);
  return res.body.error?.code === 'validation_error' ? `${res.status} ${res.body.error.message}` : `${res.status} ${JSON.stringify(res.body)}`;
}

async function mcpOutcome(tool: string, args: Record<string, unknown>): Promise<string> {
  const { body } = await mcpCall<{ content: { text?: string }[]; isError?: boolean }>('tools/call', { name: tool, arguments: args });
  const text = body.result?.content?.[0]?.text ?? JSON.stringify(body);
  return body.result?.isError ? text : `(accepted) ${text.slice(0, 80)}`;
}

describe('REST validation messages', () => {
  it('matches the recorded messages', async () => {
    const actual: Record<string, string> = {};
    for (const [label, method, path, body] of REST_CASES) actual[label] = await restOutcome(method, path, body);
    expect(actual).toEqual(REST_EXPECTED);
  });
});

describe('MCP input validation messages', () => {
  it('matches the recorded messages', async () => {
    const actual: Record<string, string> = {};
    for (const [label, tool, args] of MCP_CASES) actual[label] = await mcpOutcome(tool, args);
    expect(actual).toEqual(MCP_EXPECTED);
  });
});

const REST_EXPECTED: Record<string, string> = {
  'resolution: patches without pose_fingerprint':
    '400 pose_fingerprint: pose_fingerprint is required when patches is non-empty',
  'resolution: reference without source id':
    '400 references.0.source_generation_id: source_generation_id is required',
  'resolution: patch missing reason':
    '400 patches.0.reason: Invalid input: expected string, received undefined',
  'request update: running without worker_id':
    '400 worker_id: worker_id is required for this status transition',
  'request update: failed without worker_id and error':
    '400 worker_id: worker_id is required for this status transition; error: error is required when status is failed',
  'request update: done without result':
    '400 result: result is required when status is done',
  'request create: finalize':
    "400 kind: kind 'finalize' can no longer be created: use 'redraw' (change the picture) or 'deliver' (cut out and finish)",
  'request create: run_id on generate':
    '400 run_id: run_id is only accepted for kind import',
  'request create: resolution keys on generate':
    '400 recipe: recipe is only accepted for kind import; patches: patches is only accepted for kind import; parameters: parameters is only accepted for kind import',
  'request create: generate payload without generation':
    '400 payload.generation: Invalid input: expected record, received undefined',
  'request create: dof scope with no layer':
    '400 payload.options.scope: scope must keep at least one layer',
  'request create: lens radius without sphere':
    '400 payload.options.radius: radius is only for shape "sphere"',
  'request create: lens strength 0':
    '400 payload.options.strength: strength must not be 0',
  'request create: stage place without photo':
    '400 payload.options.place: place / height are only for a photo',
  'request create: stage photo with backdrop':
    '400 payload.options.backdrop: backdrop / shadow_from / light are not for a photo',
  'request create: repair':
    "400 kind: kinds 'repair' and 'masked_redraw' can no longer be created: use 'redraw' to change the picture (the partial-fix feature was removed)",
  'request create: redraw method missing':
    "400 payload.options.method: Invalid discriminator value. Expected 'canvas' | 'hires' | 'light'",
  'request create: deliver outlines over the limit':
    '400 payload.options.outlines: Too big: expected array to have <=6 items',
  'request create: bad recipe_ref':
    '400 recipe_ref: Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/',
  'request claim: empty kinds':
    '400 kinds: Too small: expected array to have >=1 items',
  'request claim: import is not claimable':
    '400 kinds.0: Invalid option: expected one of "generate"|"redraw"|"repair"|"masked_redraw"|"deliver"|"dof"|"lens"|"photo"|"stage"|"lighting"',
  'experiment create: non-integer seeds':
    '400 base_parameters.seeds: must be an array of 1-16 non-negative integers',
  'experiment create: seeds and count disagree':
    '400 base_parameters.count: count (3) must equal seeds length (2); omit count when seeds is given',
  'experiment update: no fields':
    '400 (root): no fields to update',
  'experiment update: bad status':
    '400 status: Invalid option: expected one of "active"|"stabilized"|"promoted"|"abandoned"',
  'run create: unexpected overrides key':
    "400 overrides: must be {} or {\"patches\": [...]}; unexpected key(s): pose, count. Generation parameters (pose, costume, count, ...) belong to the Experiment's base_parameters, not to a Run's overrides.",
  'run create: patches is not an array':
    '400 overrides.patches: must be an array of patch objects, e.g. [{ target, op, reason, value? }]',
  'run create: patches entries':
    '400 overrides.patches.0: each patch must be an object with target, op and reason; overrides.patches.1.op: must be a non-empty string; overrides.patches.1.reason: must be a non-empty string; overrides.patches.2: each patch must be an object with target, op and reason; overrides.patches.3.op: must be a non-empty string; overrides.patches.3.reason: must be a non-empty string',
  'run create: batch_id':
    '400 batch_id: batch_id is no longer supported; runs link to requests via run_id',
  'run create: variables with a boolean':
    '400 variables.a: Invalid input',
  'run update: no fields':
    '400 (root): no fields to update',
  'run update: batch_id with other fields':
    '400 batch_id: batch_id is no longer supported; runs link to requests via run_id',
  'promotion create: javascript url':
    '400 pull_request_url: must be an http(s) URL',
  'promotion create: not a url':
    '400 pull_request_url: must be an http(s) URL',
  'promotion update: no fields':
    '400 (root): no fields to update',
  'judgment: bad verdict':
    '400 verdict: Invalid option: expected one of "left"|"right"|"tie"',
  'generation update: no fields':
    '400 (root): no fields to update',
  'generation rating: bad value':
    '400 rating: Invalid option: expected one of "bad"|"neutral"|"good"',
  'generation semantic: missing schema_version':
    '400 schema_version: Invalid input: expected number, received undefined; core.pose: Invalid input: expected string, received number',
  'generation safety: probability over 1':
    '400 rating.general: Too big: expected number to be <=1; tags.a: Too small: expected number to be >=0',
  'publication create: http url':
    '400 url: url must be an https:// URL',
  'publication create: unparsable https url':
    '400 url: url must be a valid URL',
  'publication update: missing url':
    '400 url: Invalid input: expected string, received undefined',
  'observation: neither pose nor component':
    '400 pose: pose か component の少なくとも一方が必要です',
  'observation sync: records shape':
    '400 files.0.records.0.line: Too small: expected number to be >0; files.0.records.0.record: Invalid input: expected nonoptional, received undefined',
  'workbench: unknown phase key':
    "400 picks.0: phase key must be one of 1..5, got '0'; picks.7: phase key must be one of 1..5, got '7'",
  'workbench: malformed picks':
    '400 picks.1.generation_id: Too small: expected string to have >=1 characters; picks.2: Invalid input',
  'workbench: extra top-level key':
    '400 (root): Unrecognized key: "extra"',
  'job update: no fields':
    '400 (root): no fields to update',
  'job create: negative index':
    '400 seed: Invalid input: expected int, received number; index: Too small: expected number to be >=0',
  'preset promote: bad kind':
    '400 kind: Invalid option: expected one of "pose"|"costume"|"expression"|"deliver"',
  'preset import: bad recipe_ref':
    '400 recipe_ref: Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/',
  'timings put: bad prompt':
    '400 attempt: Too small: expected number to be >=0; version: Invalid option: expected one of "v1"|"v2"; prompts.0.status: Invalid option: expected one of "success"|"error"|"interrupted"|"unknown"; prompts.0.nodes.0.class_type: Invalid input: expected string, received undefined; prompts.0.nodes.0.cached: Invalid input: expected boolean, received undefined',
  'catalog put: envelope':
    '400 schema_version: Invalid input; recipes.0.name: Invalid input: expected string, received number; recipes.0.poses: Invalid input: expected array, received undefined; patches: Invalid input: expected record, received array',
  'character create: empty name':
    '400 name: Too small: expected string to have >=1 characters',
  'tag rename: empty name':
    '400 name: Too small: expected string to have >=1 characters',
};

const MCP_EXPECTED: Record<string, string> = {
  'create_experiment: duplicate arm labels':
    "Input validation error: Invalid arguments for tool create_experiment: arms.2.label: duplicate arm label 'a'",
  'create_experiment: seeds and count disagree':
    'Input validation error: Invalid arguments for tool create_experiment: parameters.count: count (3) must equal seeds length (2); omit count when seeds is given',
  'create_experiment: parameters.seeds invalid':
    'Input validation error: Invalid arguments for tool create_experiment: parameters.seeds: must be an array of 1-16 non-negative integers',
  'create_experiment: patch without reason':
    'Input validation error: Invalid arguments for tool create_experiment: arms.0.patches.0.reason: Invalid input: expected string, received undefined',
  'create_run: bad variables':
    'Input validation error: Invalid arguments for tool create_run: variables.a: Invalid input',
  'create_request: finalize kind':
    'Input validation error: Invalid arguments for tool create_request: kind: Invalid option: expected one of "generate"|"redraw"|"deliver"|"dof"|"lens"|"photo"|"stage"|"lighting"',
  'create_request: invalid deliver envelope':
    'Input validation error: Invalid arguments for tool create_request: payload.options.stroke_light: Invalid option: expected one of "even"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw", payload: Unrecognized key: "extra"',
  'create_request: bad recipe_ref':
    'Input validation error: Invalid arguments for tool create_request: recipe_ref: Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/',
  'derive_request: seeds length':
    'Input validation error: Invalid arguments for tool derive_request: seeds: seeds length (1) must equal count (2)',
  'derive_request: empty patches reason':
    'Input validation error: Invalid arguments for tool derive_request: patches.0.reason: Too small: expected string to have >=1 characters',
  'redraw_generation: hires without method fields':
    'Input validation error: Invalid arguments for tool redraw_generation: options.hires: Too small: expected number to be >=64',
  'dof_generation: scope with no layer':
    'Input validation error: Invalid arguments for tool dof_generation: scope: scope must keep at least one layer',
  'lens_generation: radius without sphere':
    'Input validation error: Invalid arguments for tool lens_generation: radius: radius is only for shape "sphere"',
  'lens_generation: strength 0':
    'Input validation error: Invalid arguments for tool lens_generation: strength: strength must not be 0',
  'stage_generation: place without photo':
    'Input validation error: Invalid arguments for tool stage_generation: place: place / height are only for a photo',
  'stage_generation: photo with backdrop':
    'Input validation error: Invalid arguments for tool stage_generation: backdrop: backdrop / shadow_from / light are not for a photo',
  'photo_generation: missing photo':
    'Input validation error: Invalid arguments for tool photo_generation: photo: Invalid input: expected string, received undefined',
  'lighting_generation: bad direction':
    'Input validation error: Invalid arguments for tool lighting_generation: direction: Invalid option: expected one of "n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw"',
  'deliver_generation: profile without name':
    'Input validation error: Invalid arguments for tool deliver_generation: profile.name: Invalid input: expected string, received undefined, profile.version: Too small: expected number to be >0',
  'list_requests: bad status':
    'Input validation error: Invalid arguments for tool list_requests: status: Invalid option: expected one of "queued"|"running"|"done"|"failed"|"cancelled"',
  'list_generations: bad limit':
    'Input validation error: Invalid arguments for tool list_generations: limit: Too small: expected number to be >=1',
  'get_generation_lineage: depth over 10':
    'Input validation error: Invalid arguments for tool get_generation_lineage: depth: Too big: expected number to be <=10',
  'list_catalog: bad recipe_ref':
    'Input validation error: Invalid arguments for tool list_catalog: recipe_ref: Invalid string: must match pattern /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/',
  'list_presets: bad kind':
    'Input validation error: Invalid arguments for tool list_presets: kind: Invalid option: expected one of "pose"|"costume"|"expression"|"deliver"',
  'promote_to_pose: bad kind':
    'Input validation error: Invalid arguments for tool promote_to_pose: kind: Invalid option: expected one of "pose"|"costume"|"expression"|"deliver"',
  'record_observation: neither pose nor component':
    'Input validation error: Invalid arguments for tool record_observation: pose: pose か component の少なくとも一方が必要です',
  'record_observation: bad outcome':
    'Input validation error: Invalid arguments for tool record_observation: outcome: Invalid option: expected one of "accepted"|"rejected"|"inconclusive"',
  'record_publication: http url':
    'Input validation error: Invalid arguments for tool record_publication: url: url must be an https:// URL',
  'set_evaluation: array evaluation':
    'Input validation error: Invalid arguments for tool set_evaluation: evaluation: Invalid input: expected record, received array',
  'plain_render: fractional seed':
    'Input validation error: Invalid arguments for tool plain_render: seed: Invalid input: expected int, received number',
};
