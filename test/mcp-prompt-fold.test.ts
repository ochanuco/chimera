import { describe, expect, it } from 'vitest';
import {
  foldBatchDigestPrompts,
  foldGenerationDetailPrompts,
  foldPromptText,
  foldRequestPayloadPrompts,
} from '../src/lib/prompt-fold';
import { createGeneration, mcpToolCall, postJson, setJobGraph } from './helpers';

const GRAPH_WITH_PROMPTS = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1234,
      steps: 20,
      cfg: 5,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'yukari.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'sampler positive forbidden-tag text', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'sampler negative forbidden-tag text', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'out' } },
};

describe('foldRequestPayloadPrompts', () => {
  it('folds generation.prompt/negative_prompt and prompt.* patch old/value, leaving non-prompt patches and everything else untouched', () => {
    const payload = {
      schema_version: 1,
      request: { instruction: 'test instruction', count: 1 },
      generation: {
        recipe: 'yukari',
        prompt: 'a beautiful girl standing',
        negative_prompt: 'ugly, bad hands',
        parameters: {},
        patches: [
          { target: 'prompt.positive', op: 'replace', reason: 'swap subject', old: 'old positive text', value: 'new positive text' },
          { target: 'pose', op: 'replace', reason: 'change pose', old: 'standing', value: 'sitting' },
        ],
      },
    };
    const snapshot = JSON.parse(JSON.stringify(payload));

    const folded = foldRequestPayloadPrompts(payload) as typeof payload;

    expect(folded.generation.prompt).toBe(foldPromptText('a beautiful girl standing'));
    expect(folded.generation.negative_prompt).toBe(foldPromptText('ugly, bad hands'));
    expect(folded.generation.patches[0]).toEqual({
      target: 'prompt.positive',
      op: 'replace',
      reason: 'swap subject',
      old: foldPromptText('old positive text'),
      value: foldPromptText('new positive text'),
    });
    // Non-prompt patch target: untouched.
    expect(folded.generation.patches[1]).toEqual(payload.generation.patches[1]);
    expect(folded.request).toEqual(payload.request);
    // Input not mutated.
    expect(payload).toEqual(snapshot);
  });

  it('folds a prompt.<part> patch and options.prompt_patch (masked_redraw payload)', () => {
    const payload = {
      generation_id: 'gen-1',
      options: {
        regions: [[0.2, 0.4, 0.8, 0.9]],
        prompt_patch: 'add a red scarf',
        denoise: 0.5,
      },
    };
    const folded = foldRequestPayloadPrompts(payload) as typeof payload;

    expect(folded.options.prompt_patch).toBe(foldPromptText('add a red scarf'));
    expect(folded.options.regions).toEqual(payload.options.regions);
    expect(folded.options.denoise).toBe(0.5);
    expect(folded.generation_id).toBe('gen-1');
    expect(payload.options.prompt_patch).toBe('add a red scarf');
  });

  it('folds experiment.overrides.patches prompt targets', () => {
    const payload = {
      schema_version: 1,
      request: { instruction: 'x', count: 1 },
      generation: {},
      experiment: {
        experiment_id: 'e1',
        run_id: 'r1',
        overrides: {
          patches: [{ target: 'prompt.positive.face', op: 'append', reason: 'blush', value: 'blushing' }],
        },
      },
    };
    const folded = foldRequestPayloadPrompts(payload) as typeof payload;
    expect(folded.experiment.overrides.patches[0]!.value).toBe(foldPromptText('blushing'));
    expect(payload.experiment.overrides.patches[0]!.value).toBe('blushing');
  });

  it('leaves non-object payloads untouched', () => {
    expect(foldRequestPayloadPrompts(null)).toBeNull();
    expect(foldRequestPayloadPrompts('x')).toBe('x');
  });
});

describe('foldGenerationDetailPrompts', () => {
  it('folds batch prompts, sampler prompts, and omits the graph', () => {
    const detail = {
      short_id: 'g1',
      batch: { id: 'b1', prompt: 'positive text', negative_prompt: 'negative text', recipe: 'yukari' },
      comfy_job: {
        id: 'j1',
        graph: { '1': { class_type: 'KSampler', inputs: {} } },
        render_facts: {
          version: 2,
          checkpoints: [],
          samplers: [{ node_id: '3', steps: 20, prompt: { positive: 'sampler positive', negative: 'sampler negative' } }],
        },
        prompt_not_reusable: null,
      },
    };
    const snapshot = JSON.parse(JSON.stringify(detail));

    const folded = foldGenerationDetailPrompts(detail) as typeof detail;

    expect(folded.batch.prompt).toBe(foldPromptText('positive text'));
    expect(folded.batch.negative_prompt).toBe(foldPromptText('negative text'));
    expect(folded.comfy_job.graph).toBeNull();
    expect((folded.comfy_job as unknown as { graph_omitted: boolean }).graph_omitted).toBe(true);
    expect(folded.comfy_job.render_facts.samplers[0]!.prompt).toEqual({
      positive: foldPromptText('sampler positive'),
      negative: foldPromptText('sampler negative'),
    });
    expect(folded.comfy_job.render_facts.samplers[0]!.steps).toBe(20);
    expect(folded.comfy_job.prompt_not_reusable).toBeNull();
    expect(detail).toEqual(snapshot);
  });

  it('leaves a null graph null without adding graph_omitted', () => {
    const detail = { batch: null, comfy_job: { id: 'j1', graph: null, render_facts: null } };
    const folded = foldGenerationDetailPrompts(detail) as typeof detail;
    expect(folded.comfy_job.graph).toBeNull();
    expect('graph_omitted' in folded.comfy_job).toBe(false);
  });
});

describe('foldBatchDigestPrompts', () => {
  it('folds batch prompts, batch.parameters.prompt_patch, and per-job sampler prompts, leaving other render_facts fields intact', () => {
    const digest = {
      batch: {
        id: 'b1',
        prompt: 'batch positive',
        negative_prompt: 'batch negative',
        parameters: { prompt_patch: 'inpaint the sleeve', layerdiffuse: true },
      },
      jobs: [
        {
          id: 'j1',
          index: 0,
          render_facts: {
            version: 2,
            samplers: [{ node_id: '3', cfg: 5, prompt: { positive: 'job positive', negative: 'job negative' } }],
          },
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(digest));

    const folded = foldBatchDigestPrompts(digest) as typeof digest;

    expect(folded.batch.prompt).toBe(foldPromptText('batch positive'));
    expect(folded.batch.negative_prompt).toBe(foldPromptText('batch negative'));
    expect(folded.batch.parameters.prompt_patch).toBe(foldPromptText('inpaint the sleeve'));
    expect(folded.batch.parameters.layerdiffuse).toBe(true);
    expect(folded.jobs[0]!.render_facts.samplers[0]!.prompt).toEqual({
      positive: foldPromptText('job positive'),
      negative: foldPromptText('job negative'),
    });
    expect(folded.jobs[0]!.render_facts.samplers[0]!.cfg).toBe(5);
    expect(folded.jobs[0]!.index).toBe(0);
    expect(digest).toEqual(snapshot);
  });
});

describe('MCP tool prompt folding', () => {
  it('get_generation folds batch prompts and sampler prompts and omits the graph by default; include_prompts: true returns originals', async () => {
    const { batch, job, generation } = await createGeneration({
      batchOverrides: { prompt: 'a long positive prompt', negative_prompt: 'ugly' },
    });
    await setJobGraph(job.id, GRAPH_WITH_PROMPTS);

    const folded = await mcpToolCall<{
      batch: { prompt: string; negative_prompt: string };
      comfy_job: { graph: unknown; graph_omitted?: boolean; render_facts: { samplers: { prompt: { positive: string; negative: string } }[] } };
    }>('get_generation', { generation_id: generation.short_id });
    expect(folded.isError).toBeFalsy();
    expect(folded.data?.batch.prompt).toBe(foldPromptText('a long positive prompt'));
    expect(folded.data?.batch.negative_prompt).toBe(foldPromptText('ugly'));
    expect(folded.data?.comfy_job.graph).toBeNull();
    expect(folded.data?.comfy_job.graph_omitted).toBe(true);
    expect(folded.data?.comfy_job.render_facts.samplers[0]?.prompt.positive).toBe(
      foldPromptText('sampler positive forbidden-tag text'),
    );
    expect(folded.text).not.toContain('forbidden-tag');
    expect(folded.text).not.toContain('a long positive prompt');

    const full = await mcpToolCall<{
      batch: { prompt: string; negative_prompt: string };
      comfy_job: { graph: unknown; graph_omitted?: boolean; render_facts: { samplers: { prompt: { positive: string; negative: string } }[] } };
    }>('get_generation', { generation_id: generation.short_id, include_prompts: true });
    expect(full.data?.batch.prompt).toBe('a long positive prompt');
    expect(full.data?.batch.negative_prompt).toBe('ugly');
    expect(full.data?.comfy_job.graph).not.toBeNull();
    expect('graph_omitted' in (full.data?.comfy_job ?? {})).toBe(false);
    expect(full.data?.comfy_job.render_facts.samplers[0]?.prompt.positive).toBe('sampler positive forbidden-tag text');

    void batch;
  });

  it('list_batch folds batch prompts and job sampler prompts by default; include_prompts: true returns originals', async () => {
    const { batch, job, generation } = await createGeneration({
      batchOverrides: { prompt: 'batch level positive prompt', negative_prompt: 'batch level negative' },
    });
    await setJobGraph(job.id, GRAPH_WITH_PROMPTS);
    void generation;

    const folded = await mcpToolCall<{
      batch: { prompt: string; negative_prompt: string };
      jobs: { render_facts: { samplers: { prompt: { positive: string; negative: string } }[] } }[];
    }>('list_batch', { batch_id: batch.id });
    expect(folded.isError).toBeFalsy();
    expect(folded.data?.batch.prompt).toBe(foldPromptText('batch level positive prompt'));
    expect(folded.data?.batch.negative_prompt).toBe(foldPromptText('batch level negative'));
    expect(folded.data?.jobs[0]?.render_facts.samplers[0]?.prompt.positive).toBe(
      foldPromptText('sampler positive forbidden-tag text'),
    );
    expect(folded.text).not.toContain('forbidden-tag');

    const full = await mcpToolCall<{
      batch: { prompt: string; negative_prompt: string };
      jobs: { render_facts: { samplers: { prompt: { positive: string; negative: string } }[] } }[];
    }>('list_batch', { batch_id: batch.id, include_prompts: true });
    expect(full.data?.batch.prompt).toBe('batch level positive prompt');
    expect(full.data?.batch.negative_prompt).toBe('batch level negative');
    expect(full.data?.jobs[0]?.render_facts.samplers[0]?.prompt.positive).toBe('sampler positive forbidden-tag text');
  });

  it('get_request / list_requests fold prompt.* patch values by default; include_prompts: true returns originals', async () => {
    const payload = {
      schema_version: 1,
      request: { instruction: 'swap the prompt', count: 1 },
      generation: {
        recipe: 'yukari',
        parameters: {},
        patches: [
          {
            target: 'prompt.positive',
            op: 'replace',
            reason: 'swap subject',
            old: 'old sampler prompt',
            value: 'new prompt with a forbidden-tag',
          },
        ],
      },
    };
    const createRes = await postJson<{ id: string }>('/api/v1/requests', {
      kind: 'generate',
      payload,
      idempotency_key: crypto.randomUUID(),
      created_by: 'mcp',
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id;

    const folded = await mcpToolCall<{ payload: { generation: { patches: { value: string; old: string }[] } } }>('get_request', {
      id,
    });
    expect(folded.isError).toBeFalsy();
    expect(folded.data?.payload.generation.patches[0]?.value).toBe(foldPromptText('new prompt with a forbidden-tag'));
    expect(folded.data?.payload.generation.patches[0]?.old).toBe(foldPromptText('old sampler prompt'));
    expect(folded.text).not.toContain('forbidden-tag');

    const full = await mcpToolCall<{ payload: { generation: { patches: { value: string; old: string }[] } } }>('get_request', {
      id,
      include_prompts: true,
    });
    expect(full.data?.payload.generation.patches[0]?.value).toBe('new prompt with a forbidden-tag');
    expect(full.data?.payload.generation.patches[0]?.old).toBe('old sampler prompt');

    const listFolded = await mcpToolCall<{ items: { id: string; payload: { generation: { patches: { value: string }[] } } }[] }>(
      'list_requests',
      {},
    );
    expect(listFolded.isError).toBeFalsy();
    const listedItem = listFolded.data?.items.find((item) => item.id === id);
    expect(listedItem?.payload.generation.patches[0]?.value).toBe(foldPromptText('new prompt with a forbidden-tag'));
  });
});
