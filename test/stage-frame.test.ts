import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { findStageFrameDefaults } from '../src/lib/catalogs';
import { frameJs } from '../src/ui/frame-editor';
import { createGeneration, mcpToolCall, postJson, req, TINY_PNG } from './helpers';

const FRAME = {
  box: [0.1, 0.3, 0.9, 1],
  sides: { top: 'out', right: 'behind', bottom: 'behind', left: 'cut' },
  line: { color: '#4a3152', width: 1.8, pattern: 'slash' },
  rim: { color: '#2e2236', width: 0.25 },
  paper: '#ffffff',
  expand: { top: true, right: false, bottom: false },
  canvas: [-0.2, null, null, null],
  strokes: [{ mode: 'erase', width: 2, points: [[0.2, 0.4], [0.3, 0.5]] }],
};

const stagePayload = (generationId: string, options: unknown) => ({
  kind: 'stage',
  payload: { generation_id: generationId, options },
  idempotency_key: crypto.randomUUID(),
  created_by: 'gui',
});

async function addLayers(generationId: string) {
  for (const role of ['layer-figure', 'layer-outline']) {
    const form = new FormData();
    form.set('metadata', JSON.stringify({ role }));
    form.set('file', new File([TINY_PNG], 'layer.png', { type: 'image/png' }));
    const res = await req(`/api/v1/generations/${generationId}/assets`, { method: 'POST', body: form });
    expect(res.status).toBe(201);
  }
}

function initialData(html: string): Record<string, any> {
  const match = html.match(/data-initial="([^"]*)"/);
  expect(match).not.toBeNull();
  const decoded = (match?.[1] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

describe('stage frame validation', () => {
  it('stores a frame on a pattern stage through REST and MCP', async () => {
    const { generation } = await createGeneration();
    const rest = await postJson<{ payload: unknown }>('/api/v1/requests', stagePayload(generation.id, { backdrop: 'dots', frame: FRAME }));
    expect(rest.status).toBe(201);
    expect(rest.body.payload).toEqual({ generation_id: generation.id, options: { backdrop: 'dots', frame: FRAME } });

    const mcp = await mcpToolCall<{ request: { payload: unknown } }>('stage_generation', {
      generation_id: generation.id,
      backdrop: '#ffeeaa',
      frame: FRAME,
      idempotency_key: crypto.randomUUID(),
    });
    expect(mcp.isError).toBe(false);
    expect(mcp.data?.request.payload).toEqual({ generation_id: generation.short_id, options: { backdrop: '#ffeeaa', frame: FRAME } });
  });

  it('accepts expand as one boolean and a canvas of all automatic edges', async () => {
    const { generation } = await createGeneration();
    const frame = { box: [0.1, 0.3, 0.9, 1], expand: false, canvas: [null, null, null, null] };
    const res = await postJson<{ payload: unknown }>('/api/v1/requests', stagePayload(generation.id, { frame }));
    expect(res.status).toBe(201);
    expect(res.body.payload).toEqual({ generation_id: generation.id, options: { frame } });
  });

  const points = (n: number) => Array.from({ length: n }, () => [0.5, 0.5]);
  const stroke = (n: number) => ({ mode: 'erase', width: 2, points: points(n) });
  const REJECTS: [label: string, options: unknown, message?: string][] = [
    ['frame with photo', { photo: 'p', frame: FRAME }, 'frame is not for a photo'],
    ['box x0 >= x1', { frame: { box: [0.5, 0, 0.5, 1] } }, 'frame box must have x0 < x1 and y0 < y1'],
    ['canvas y0 >= y1', { frame: { box: [0, 0, 1, 1], canvas: [0, 1, 1, 0.5] } }, 'frame canvas must have x0 < x1 and y0 < y1'],
    ['box out of range', { frame: { box: [-1.5, 0, 1, 1] } }],
    ['unknown key', { frame: { box: [0, 0, 1, 1], extra: 1 } }],
    ['bad side', { frame: { box: [0, 0, 1, 1], sides: { top: 'in' } } }],
    ['non-boolean expand', { frame: { box: [0, 0, 1, 1], expand: 'no' } }],
    ['unknown expand side', { frame: { box: [0, 0, 1, 1], expand: { up: false } } }],
    ['non-boolean expand side', { frame: { box: [0, 0, 1, 1], expand: { top: 'no' } } }],
    ['canvas edges crossed', { frame: { box: [0, 0, 1, 1], canvas: [0.6, null, 0.4, null] } }, 'frame canvas must have x0 < x1 and y0 < y1'],
    ['canvas edge out of range', { frame: { box: [0, 0, 1, 1], canvas: [null, -1.5, null, null] } }],
    ['more than 200 strokes', { frame: { box: [0, 0, 1, 1], strokes: Array.from({ length: 201 }, () => stroke(1)) } }],
    ['more than 2000 points in a stroke', { frame: { box: [0, 0, 1, 1], strokes: [stroke(2001)] } }],
    ['empty stroke', { frame: { box: [0, 0, 1, 1], strokes: [stroke(0)] } }],
    [
      'more than 20000 points in total',
      { frame: { box: [0, 0, 1, 1], strokes: Array.from({ length: 11 }, () => stroke(2000)) } },
      'frame strokes have more than 20000 points in total',
    ],
    ['bad hex paper', { frame: { box: [0, 0, 1, 1], paper: '#fff' } }],
    ['bad hex line color', { frame: { box: [0, 0, 1, 1], line: { color: 'red' } } }],
    ['line width over 5', { frame: { box: [0, 0, 1, 1], line: { width: 5.1 } } }],
    ['bad hex rim color', { frame: { box: [0, 0, 1, 1], rim: { color: 'black' } } }],
    ['bad line pattern', { frame: { box: [0, 0, 1, 1], line: { pattern: 'dots' } } }],
    ['rim with a pattern', { frame: { box: [0, 0, 1, 1], rim: { pattern: 'slash' } } }],
    ['rim width over 5', { frame: { box: [0, 0, 1, 1], rim: { width: 5.1 } } }],
    ['stroke width 0', { frame: { box: [0, 0, 1, 1], strokes: [{ mode: 'erase', width: 0, points: [[0, 0]] }] } }],
    ['stroke point out of range', { frame: { box: [0, 0, 1, 1], strokes: [{ mode: 'restore', width: 1, points: [[0, 2.5]] }] } }],
  ];

  it.each(REJECTS)('rejects %s', async (_label, options, message) => {
    const res = await postJson<{ error: { message: string } }>('/api/v1/requests', stagePayload('missing-id', options));
    expect(res.status).toBe(400);
    if (message) expect(res.body.error.message).toContain(message);
  });

  it('rejects frame with photo and a bad frame over MCP', async () => {
    const { generation } = await createGeneration();
    for (const bad of [{ photo: generation.id, frame: FRAME }, { frame: { box: [0.9, 0, 0.1, 1] } }, { frame: { box: [0, 0, 1, 1], paper: 'white' } }]) {
      const call = await mcpToolCall('stage_generation', { generation_id: generation.id, ...bad, idempotency_key: crypto.randomUUID() });
      expect(call.isError).toBe(true);
    }
  });
});

describe('frame editor page', () => {
  it('serves the editor for a generation with both layers', async () => {
    const { generation } = await createGeneration();
    await addLayers(generation.id);
    const res = await req(`/frame/${generation.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const data = initialData(html);
    expect(data.base.short_id).toBe(generation.short_id);
    expect(data.layers.figure).toBe(`/g/${generation.short_id}/assets/layer-figure`);
    expect(data.initial).toBeNull();
    expect(html).toContain(`href="/work/${generation.short_id}"`);
    expect(html).toContain('/assets/frame.js?v=');
  });

  it('answers 404 with a message when a layer is missing', async () => {
    const { generation } = await createGeneration();
    const none = await req(`/frame/${generation.short_id}`);
    expect(none.status).toBe(404);
    expect(await none.text()).toContain('人物レイヤーがない');

    const form = new FormData();
    form.set('metadata', JSON.stringify({ role: 'layer-figure' }));
    form.set('file', new File([TINY_PNG], 'layer.png', { type: 'image/png' }));
    await req(`/api/v1/generations/${generation.id}/assets`, { method: 'POST', body: form });
    expect((await req(`/frame/${generation.short_id}`)).status).toBe(404);
    expect((await req('/frame/nope')).status).toBe(404);
  });

  it('restores the state of a framed stage output on its source', async () => {
    const { generation: base } = await createGeneration();
    await addLayers(base.id);
    const options = { backdrop: 'dots', shadow_from: null, frame: FRAME };
    const { request, generation: output } = await createGeneration({
      requestOverrides: { kind: 'stage', payload: { generation_id: base.short_id, options } },
    });
    await env.DB.prepare('UPDATE requests SET result_json = ? WHERE id = ?')
      .bind(JSON.stringify({ generation_ids: [output.id] }), request.id)
      .run();

    const res = await req(`/frame/${output.short_id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const data = initialData(html);
    expect(data.base.short_id).toBe(base.short_id);
    expect(data.initial).toEqual(options);
    expect(html).toContain(`href="/g/${output.short_id}"`);
  });
});

describe('frame editor entry points and assets', () => {
  it('shows the 枠に入れる link on the detail page only with layers', async () => {
    const { generation } = await createGeneration();
    expect(await (await req(`/g/${generation.short_id}`)).text()).not.toContain('枠に入れる');
    await addLayers(generation.id);
    expect(await (await req(`/g/${generation.short_id}`)).text()).toContain(`href="/frame/${generation.short_id}"`);
  });

  it('serves frame.js as immutable javascript that parses', async () => {
    const res = await req('/assets/frame.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/javascript');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(() => new Function(frameJs)).not.toThrow();
  });
});

describe('findStageFrameDefaults', () => {
  it('reads stage.frame and leaves out what the catalog lacks', () => {
    const doc = { stage: { frame: { sides: { top: 'out' }, line: { color: '#885b80', width: 0.6 }, rim: { color: '#2e2236', width: 0.25 }, paper: '#ffffff', expand: true } } };
    expect(findStageFrameDefaults(doc as never)).toEqual({
      sides: { top: 'out' },
      line: { color: '#885b80', width: 0.6 },
      rim: { color: '#2e2236', width: 0.25 },
      paper: '#ffffff',
      expand: true,
    });
    expect(findStageFrameDefaults({ stage: { frame: {} } } as never)).toEqual({ sides: null, line: null, rim: null, paper: null, expand: null });
    expect(findStageFrameDefaults({} as never)).toBeNull();
  });
});
