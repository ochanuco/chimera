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

async function seed(rows: { character: string; pose: string; parameter: string; value: string; outcome: string; reason: string }[]) {
  for (const row of rows) {
    const res = await postJson<Observation>('/api/v1/observations', { ...row, idempotency_key: crypto.randomUUID() });
    expect(res.status).toBe(201);
  }
}

describe('Observation REST', () => {
  it('q matches a substring of parameter, value or reason', async () => {
    const character = uniqueCharacter();
    await seed([
      { character, pose: 'stand', parameter: 'legwear-gap', value: '1.4', outcome: 'accepted', reason: 'clean separation' },
      { character, pose: 'stand', parameter: 'smug', value: 'legwear-tone', outcome: 'accepted', reason: 'fine' },
      { character, pose: 'stand', parameter: 'unrelated', value: '0.9', outcome: 'accepted', reason: 'mentions legwear boundary' },
      { character, pose: 'stand', parameter: 'other', value: '0.1', outcome: 'accepted', reason: 'no match here' },
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
    await seed([
      { character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' },
      { character, pose: 'sit', parameter: 'a', value: '1', outcome: 'rejected', reason: 'r2' },
      { character: otherCharacter, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r3' },
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
    await seed([{ character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' }]);

    const rest = await getJson<{ items: Observation[] }>(`/api/v1/observations?character=${character}`);
    const tool = await mcpToolCall<{ items: Observation[] }>('list_observations', { character });
    expect(tool.isError).toBe(false);
    expect(tool.data?.items.map((o) => o.id).sort()).toEqual(rest.body.items.map((o) => o.id).sort());
  });

  it('get_observation returns the same row as GET /api/v1/observations/{id}', async () => {
    const character = uniqueCharacter();
    await seed([{ character, pose: 'stand', parameter: 'a', value: '1', outcome: 'accepted', reason: 'r1' }]);
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
