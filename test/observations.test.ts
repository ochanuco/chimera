import { describe, expect, it } from 'vitest';
import { getJson, mcpToolCall, postJson } from './helpers';
import { canonicalPayloadHash } from '../src/lib/requests';

function uniqueCharacter(): string {
  return `yukari-${crypto.randomUUID()}`;
}

interface Observation {
  id: string;
  character: string;
  pose: string | null;
  component: string | null;
  parameter: string;
  value: string;
  outcome: string;
  reason: string;
  seed: number | null;
  render_id: string | null;
  generation_ids: string[] | null;
  recipe: string | null;
  observed_at: string | null;
  supersedes_id: string | null;
  source: string;
  created_at: string;
}

interface SyncResult {
  inserted: number;
  unchanged: number;
  skipped: { path: string; line: number; reason: string; record: unknown }[];
}

function sync(files: { path: string; records: { line: number; component?: string; record: unknown }[] }[]) {
  return postJson<SyncResult>('/api/v1/observations/sync', { files });
}

describe('Observation sync', () => {
  it('is idempotent: the same record synced twice does not add a second row', async () => {
    const character = uniqueCharacter();
    const path = `experiments/${character}/stand.jsonl`;
    const record = { character, pose: 'stand', parameter: 'smug', value: '1.4', outcome: 'accepted', reason: 'read as confident' };

    const first = await sync([{ path, records: [{ line: 1, record }] }]);
    expect(first.status).toBe(200);
    expect(first.body.inserted).toBe(1);
    expect(first.body.unchanged).toBe(0);

    const second = await sync([{ path, records: [{ line: 1, record }] }]);
    expect(second.status).toBe(200);
    expect(second.body.inserted).toBe(0);
    expect(second.body.unchanged).toBe(1);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(list.body.items).toHaveLength(1);
  });

  it('assigns a different id (and row) to the same content on a different line', async () => {
    const character = uniqueCharacter();
    const path = `experiments/${character}/stand.jsonl`;
    const record = { character, pose: 'stand', parameter: 'smug', value: '1.4', outcome: 'accepted', reason: 'reproduced' };

    const res = await sync([
      {
        path,
        records: [
          { line: 1, record },
          { line: 2, record },
        ],
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.unchanged).toBe(0);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(list.body.items).toHaveLength(2);
    expect(new Set(list.body.items.map((o) => o.id)).size).toBe(2);
  });

  it('the same path and line sync to the same row (unchanged), even called separately', async () => {
    const character = uniqueCharacter();
    const path = `experiments/${character}/stand.jsonl`;
    const record = { character, pose: 'stand', parameter: 'smug', value: '1.4', outcome: 'accepted', reason: 'first pass' };

    await sync([{ path, records: [{ line: 5, record }] }]);
    const res = await sync([{ path, records: [{ line: 5, record }] }]);
    expect(res.body.inserted).toBe(0);
    expect(res.body.unchanged).toBe(1);
  });

  it('skips a record with neither pose nor component', async () => {
    const character = uniqueCharacter();
    const record = { character, parameter: 'smug', value: '1.4', outcome: 'accepted', reason: 'no pose or component here' };

    const res = await sync([{ path: `experiments/${character}/notes.jsonl`, records: [{ line: 1, record }] }]);
    expect(res.body.inserted).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0]?.reason).toBe('no pose or component');
  });

  it('skips an experiment-arm record (verdict/arms, not axis+arms)', async () => {
    const character = uniqueCharacter();
    const record = {
      character,
      pose: 'stand',
      batch_id: 'b1',
      seeds: [1, 2, 3],
      verdict: 'arm-a wins',
      observation: 'arm-a read cleaner',
      arms: { a: {}, b: {} },
    };

    const res = await sync([{ path: `experiments/${character}/stand.jsonl`, records: [{ line: 1, record }] }]);
    expect(res.body.inserted).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0]?.reason).toBe('experiment arm, not an observation');
  });

  it('normalizes "not adopted" to "rejected"', async () => {
    const character = uniqueCharacter();
    const record = { character, pose: 'stand', parameter: 'smug', value: '1.4', outcome: 'not adopted', reason: 'lost a sweep' };

    const res = await sync([{ path: `experiments/${character}/stand.jsonl`, records: [{ line: 1, record }] }]);
    expect(res.body.inserted).toBe(1);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(list.body.items[0]?.outcome).toBe('rejected');
  });

  it('skips a record with an outcome outside the vocabulary', async () => {
    const character = uniqueCharacter();
    const record = { character, pose: 'stand', parameter: 'smug', value: '1.4', outcome: 'maybe', reason: 'unsure' };

    const res = await sync([{ path: `experiments/${character}/stand.jsonl`, records: [{ line: 1, record }] }]);
    expect(res.body.inserted).toBe(0);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0]?.reason).toBe('unknown outcome: maybe');
  });

  it('converts an axis+arms (form C) record, taking generation_ids from picked and component from the sync entry', async () => {
    const character = uniqueCharacter();
    const accepted = {
      character,
      axis: 'smug_weight',
      arms: { low: { seed: 1 }, high: { seed: 2 } },
      picked: ['gen-1', 'gen-2'],
      observation: 'high read cleaner across seeds',
      date: '2026-01-01',
    };
    const inconclusive = {
      character,
      axis: 'smug_weight',
      arms: { low: { seed: 1 }, high: { seed: 2 } },
      picked: [],
      observation: 'no clear winner',
      date: '2026-01-02',
    };

    const res = await sync([
      {
        path: `experiments/${character}/delivery_style.jsonl`,
        records: [
          { line: 1, component: 'prompt_style', record: accepted },
          { line: 2, component: 'prompt_style', record: inconclusive },
        ],
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.skipped).toEqual([]);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    const byReason = new Map(list.body.items.map((o) => [o.reason, o]));

    const acceptedRow = byReason.get('high read cleaner across seeds');
    expect(acceptedRow?.component).toBe('prompt_style');
    expect(acceptedRow?.pose).toBeNull();
    expect(acceptedRow?.parameter).toBe('smug_weight');
    expect(acceptedRow?.value).toBe('low, high');
    expect(acceptedRow?.outcome).toBe('accepted');
    expect(acceptedRow?.generation_ids).toEqual(['gen-1', 'gen-2']);
    expect(acceptedRow?.observed_at).toBe('2026-01-01');

    const inconclusiveRow = byReason.get('no clear winner');
    expect(inconclusiveRow?.outcome).toBe('inconclusive');
  });

  it('q matches a substring of parameter, value or reason', async () => {
    const character = uniqueCharacter();
    await sync([
      {
        path: `experiments/${character}/stand.jsonl`,
        records: [
          { line: 1, record: { character, pose: 'stand', parameter: 'legwear-gap', value: '1.4', outcome: 'accepted', reason: 'clean separation' } },
          { line: 2, record: { character, pose: 'stand', parameter: 'smug', value: 'legwear-tone', outcome: 'accepted', reason: 'fine' } },
          { line: 3, record: { character, pose: 'stand', parameter: 'unrelated', value: '0.9', outcome: 'accepted', reason: 'mentions legwear boundary' } },
          { line: 4, record: { character, pose: 'stand', parameter: 'other', value: '0.1', outcome: 'accepted', reason: 'no match here' } },
        ],
      },
    ]);

    const byParameter = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}&q=legwear-gap`);
    expect(byParameter.body.items.map((o) => o.parameter)).toEqual(['legwear-gap']);

    const byValue = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}&q=legwear-tone`);
    expect(byValue.body.items.map((o) => o.value)).toEqual(['legwear-tone']);

    const byReason = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}&q=legwear boundary`);
    expect(byReason.body.items.map((o) => o.reason)).toEqual(['mentions legwear boundary']);
  });

  it('filters by character, pose and outcome', async () => {
    const character = uniqueCharacter();
    const otherCharacter = uniqueCharacter();
    await sync([
      {
        path: `experiments/${character}/stand.jsonl`,
        records: [
          { line: 1, record: { character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' } },
          { line: 2, record: { character, pose: 'sit', parameter: 'a', value: '1', outcome: 'rejected', reason: 'r2' } },
        ],
      },
      {
        path: `experiments/${otherCharacter}/stand.jsonl`,
        records: [{ line: 1, record: { character: otherCharacter, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r3' } }],
      },
    ]);

    const byCharacter = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(byCharacter.body.items).toHaveLength(2);

    const byPose = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}&pose=stand`);
    expect(byPose.body.items.map((o) => o.reason)).toEqual(['r1']);

    const byOutcome = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}&outcome=rejected`);
    expect(byOutcome.body.items.map((o) => o.reason)).toEqual(['r2']);
  });
});

describe('MCP list_observations / get_observation / record_observation', () => {
  it('list_observations returns the same items as GET /api/v1/observations', async () => {
    const character = uniqueCharacter();
    await sync([
      {
        path: `experiments/${character}/stand.jsonl`,
        records: [{ line: 1, record: { character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' } }],
      },
    ]);

    const rest = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    const tool = await mcpToolCall<{ items: Observation[] }>('list_observations', { character });
    expect(tool.isError).toBe(false);
    expect(tool.data?.items.map((o) => o.id).sort()).toEqual(rest.body.items.map((o) => o.id).sort());
  });

  it('get_observation returns the same row as GET /api/v1/observations/{id}', async () => {
    const character = uniqueCharacter();
    await sync([
      {
        path: `experiments/${character}/stand.jsonl`,
        records: [{ line: 1, record: { character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' } }],
      },
    ]);
    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    const id = list.body.items[0]!.id;

    const rest = await getJson<Observation>(`/api/v1/observations/${id}`);
    const tool = await mcpToolCall<Observation>('get_observation', { id });
    expect(tool.isError).toBe(false);
    expect(tool.data).toEqual(rest.body);
  });

  it('get_observation 404s as a tool error for an unknown id', async () => {
    const tool = await mcpToolCall('get_observation', { id: 'nonexistent' });
    expect(tool.isError).toBe(true);
  });

  it('record_observation appends one Observation and replays on the same idempotency_key', async () => {
    const character = uniqueCharacter();
    const args = {
      character,
      pose: 'stand',
      parameter: 'smug',
      value: '1.4',
      outcome: 'accepted' as const,
      reason: 'read as confident under the boss block',
      idempotency_key: crypto.randomUUID(),
    };

    const first = await mcpToolCall<Observation>('record_observation', args);
    expect(first.isError).toBe(false);
    expect(first.data?.source).toBe('mcp');

    const second = await mcpToolCall<Observation>('record_observation', args);
    expect(second.isError).toBe(false);
    expect(second.data?.id).toBe(first.data?.id);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(list.body.items).toHaveLength(1);
  });

  it('record_observation gives a re-measurement its own row when the key differs, even byte-identical', async () => {
    const character = uniqueCharacter();
    const base = {
      character,
      pose: 'stand',
      parameter: 'smug',
      value: '1.4',
      outcome: 'accepted' as const,
      reason: 'read as confident under the boss block',
    };

    const first = await mcpToolCall<Observation>('record_observation', { ...base, idempotency_key: crypto.randomUUID() });
    const second = await mcpToolCall<Observation>('record_observation', { ...base, idempotency_key: crypto.randomUUID() });
    expect(first.data?.id).not.toBe(second.data?.id);

    const list = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    expect(list.body.items).toHaveLength(2);
  });
});

describe('canonicalPayloadHash after the json-canonical.ts extraction', () => {
  it('is unchanged: key order does not affect the hash, and the value matches a fixed golden hash', async () => {
    const a = await canonicalPayloadHash('generate', { b: 1, a: 2 });
    const b = await canonicalPayloadHash('generate', { a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('6ad3565d1c451e8d486d92fbb02a196075e174aef9a9e3fde60ff70007b7c4f0');
  });
});
