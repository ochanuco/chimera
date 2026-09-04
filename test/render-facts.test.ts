import { describe, expect, it } from 'vitest';
import { diffFactSummaries, extractRenderFacts, promptDelta, summarizeRenderFacts, type RenderFacts } from '../src/lib/render-facts';

// 1. DiffusersLoader graph: single pass, no loras/controlnets, canvas has no final_size.
const DIFFUSERS_GRAPH = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1234,
      steps: 28,
      cfg: 5.5,
      sampler_name: 'euler_ancestral',
      scheduler: 'karras',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-v3' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'out' } },
};

// 2. CheckpointLoaderSimple graph with a lora and an advanced controlnet application (not wired
// into the sampler's prompt inputs -- prompt resolution is exercised separately below).
const CHECKPOINT_LORA_CONTROLNET_GRAPH = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['4', 1] } },
  '10': {
    class_type: 'LoraLoader',
    inputs: { lora_name: 'detail.safetensors', strength_model: 0.8, strength_clip: 0.6, model: ['4', 0], clip: ['4', 1] },
  },
  '11': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'openpose.safetensors' } },
  '12': {
    class_type: 'ControlNetApplyAdvanced',
    inputs: { strength: 0.7, start_percent: 0, end_percent: 0.8, control_net: ['11', 0], image: ['5', 0] },
  },
};

// 3. UNETLoader + CLIPLoader + VAELoader graph (no CheckpointLoaderSimple / DiffusersLoader at
// all). positive/negative point straight at the CLIPLoader node (not a CLIPTextEncode), so
// prompt resolution intentionally comes back null.
const UNET_CLIP_GRAPH = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'anima.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'clip.safetensors' } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 99,
      steps: 25,
      cfg: 6,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 1,
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['2', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
};

// 4. chain_pass graph: first pass DiffusersLoader "4" (prompt via node "6"), literal ImageScale
// upscale, second pass against a different DiffusersLoader ("20") with a distinct hires prompt
// via node "6b" -- so pass 1 / pass 2 positive prompts differ.
const CHAIN_PASS_GRAPH = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 1234,
      steps: 28,
      cfg: 5.5,
      sampler_name: 'euler_ancestral',
      scheduler: 'karras',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-v3' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '10': { class_type: 'ImageScale', inputs: { image: ['8', 0], upscale_method: 'lanczos', width: 1248, height: 1824, crop: 'disabled' } },
  '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['20', 2] } },
  '12': {
    class_type: 'KSampler',
    inputs: {
      seed: 1234,
      steps: 20,
      cfg: 4,
      sampler_name: 'dpmpp_2m',
      scheduler: 'karras',
      denoise: 0.45,
      model: ['20', 0],
      positive: ['6b', 0],
      negative: ['7', 0],
      latent_image: ['11', 0],
    },
  },
  '6b': { class_type: 'CLIPTextEncode', inputs: { text: 'a, hires detail', clip: ['20', 1] } },
  '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['20', 2] } },
  '20': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-finalize' } },
};

// 5. positive prompt routed through a ControlNetApplyAdvanced sitting between the KSampler and
// the CLIPTextEncode.
const CONTROLNET_PROMPT_GRAPH = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 5,
      steps: 15,
      cfg: 6,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['12', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'bad hands', clip: ['4', 1] } },
  '11': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'openpose.safetensors' } },
  '12': {
    class_type: 'ControlNetApplyAdvanced',
    inputs: { strength: 0.7, start_percent: 0, end_percent: 0.8, control_net: ['11', 0], positive: ['6', 0], negative: ['7', 0] },
  },
};

// 6. CLIPTextEncode.text referencing a PrimitiveNode-like node, resolved one hop via `value`.
const PRIMITIVE_TEXT_GRAPH = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 7,
      steps: 10,
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
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: ['8', 0], clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'neg', clip: ['4', 1] } },
  '8': { class_type: 'PrimitiveNode', inputs: { value: 'primitive positive text' } },
};

const EMPTY_FACTS: RenderFacts = {
  version: 2,
  checkpoints: [],
  models: { clip: [], vae: null },
  samplers: [],
  canvas: null,
  loras: [],
  controlnets: [],
  seed: null,
  output: { filename_prefix: null },
};

describe('extractRenderFacts', () => {
  it('extracts a single-pass DiffusersLoader graph', () => {
    expect(extractRenderFacts(DIFFUSERS_GRAPH)).toEqual({
      version: 2,
      checkpoints: ['yukari-v3'],
      models: { clip: [], vae: null },
      samplers: [
        {
          node_id: '3',
          steps: 28,
          cfg: 5.5,
          sampler_name: 'euler_ancestral',
          scheduler: 'karras',
          denoise: 1,
          seed: 1234,
          prompt: { positive: 'a', negative: 'b' },
          latent: { kind: 'empty', width: 832, height: 1216, upscale_method: null, scale_by: null, from_node_id: null },
        },
      ],
      canvas: { width: 832, height: 1216, final_size: null },
      loras: [],
      controlnets: [],
      seed: 1234,
      output: { filename_prefix: 'out' },
    });
  });

  it('extracts a CheckpointLoaderSimple graph with a lora and an advanced controlnet', () => {
    expect(extractRenderFacts(CHECKPOINT_LORA_CONTROLNET_GRAPH)).toEqual({
      version: 2,
      checkpoints: ['model.safetensors'],
      models: { clip: [], vae: null },
      samplers: [
        {
          node_id: '3',
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          seed: 1,
          prompt: { positive: 'a', negative: 'b' },
          latent: { kind: 'empty', width: 512, height: 512, upscale_method: null, scale_by: null, from_node_id: null },
        },
      ],
      canvas: { width: 512, height: 512, final_size: null },
      loras: [{ lora_name: 'detail.safetensors', strength_model: 0.8, strength_clip: 0.6 }],
      controlnets: [{ control_net_name: 'openpose.safetensors', strength: 0.7, start_percent: 0, end_percent: 0.8 }],
      seed: 1,
      output: { filename_prefix: null },
    });
  });

  it('extracts checkpoints from UNETLoader when there is no CheckpointLoaderSimple/DiffusersLoader, and models from CLIPLoader/VAELoader', () => {
    expect(extractRenderFacts(UNET_CLIP_GRAPH)).toEqual({
      version: 2,
      checkpoints: ['anima.safetensors'],
      models: { clip: ['clip.safetensors'], vae: 'vae.safetensors' },
      samplers: [
        {
          node_id: '3',
          steps: 25,
          cfg: 6,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 1,
          seed: 99,
          prompt: { positive: null, negative: null },
          latent: { kind: 'empty', width: 1024, height: 1024, upscale_method: null, scale_by: null, from_node_id: null },
        },
      ],
      canvas: { width: 1024, height: 1024, final_size: null },
      loras: [],
      controlnets: [],
      seed: 99,
      output: { filename_prefix: null },
    });
  });

  it('extracts a chain_pass graph: two checkpoints, two samplers in node-id order, literal final_size, differing pass prompts, and image-upscale latent chained to pass 1', () => {
    expect(extractRenderFacts(CHAIN_PASS_GRAPH)).toEqual({
      version: 2,
      checkpoints: ['yukari-v3', 'yukari-finalize'],
      models: { clip: [], vae: null },
      samplers: [
        {
          node_id: '3',
          steps: 28,
          cfg: 5.5,
          sampler_name: 'euler_ancestral',
          scheduler: 'karras',
          denoise: 1,
          seed: 1234,
          prompt: { positive: 'a', negative: 'b' },
          latent: { kind: 'empty', width: 832, height: 1216, upscale_method: null, scale_by: null, from_node_id: null },
        },
        {
          node_id: '12',
          steps: 20,
          cfg: 4,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 0.45,
          seed: 1234,
          prompt: { positive: 'a, hires detail', negative: 'b' },
          latent: { kind: 'image_upscale', width: 1248, height: 1824, upscale_method: 'lanczos', scale_by: null, from_node_id: '3' },
        },
      ],
      canvas: { width: 832, height: 1216, final_size: { width: 1248, height: 1824 } },
      loras: [],
      controlnets: [],
      seed: 1234,
      output: { filename_prefix: null },
    });
  });

  it('resolves a positive prompt routed through a ControlNetApplyAdvanced node', () => {
    const facts = extractRenderFacts(CONTROLNET_PROMPT_GRAPH);
    expect(facts.samplers[0]!.prompt).toEqual({ positive: 'a cat', negative: 'bad hands' });
  });

  it('resolves a CLIPTextEncode.text reference one hop to a PrimitiveNode-like value', () => {
    const facts = extractRenderFacts(PRIMITIVE_TEXT_GRAPH);
    expect(facts.samplers[0]!.prompt).toEqual({ positive: 'primitive positive text', negative: 'neg' });
  });

  it('returns empty facts for a non-object or empty graph', () => {
    expect(extractRenderFacts(null)).toEqual(EMPTY_FACTS);
    expect(extractRenderFacts(undefined)).toEqual(EMPTY_FACTS);
    expect(extractRenderFacts('not a graph')).toEqual(EMPTY_FACTS);
    expect(extractRenderFacts([])).toEqual(EMPTY_FACTS);
    expect(extractRenderFacts({})).toEqual(EMPTY_FACTS);
  });
});

describe('summarizeRenderFacts', () => {
  it('returns all-null for a null RenderFacts', () => {
    expect(summarizeRenderFacts(null)).toEqual({
      checkpoint: null,
      sampler: null,
      steps: null,
      cfg: null,
      denoise: null,
      canvas: null,
      lora: null,
      controlnet: null,
    });
  });

  it('summarizes the chain_pass fixture: joined checkpoints, per-sampler arrows, last-sampler denoise', () => {
    const facts = extractRenderFacts(CHAIN_PASS_GRAPH);
    const summary = summarizeRenderFacts(facts);
    expect(summary.checkpoint).toBe('yukari-v3, yukari-finalize');
    expect(summary.sampler).toBe('euler_ancestral/karras → dpmpp_2m/karras');
    expect(summary.steps).toBe('28 → 20');
    expect(summary.denoise).toBe('0.45');
    expect(summary.canvas).toBe('832x1216 → 1248x1824');
    expect(summary.lora).toBeNull();
    expect(summary.controlnet).toBeNull();
  });

  it('collapses per-sampler values to one when every sampler agrees', () => {
    const facts = extractRenderFacts(DIFFUSERS_GRAPH);
    const summary = summarizeRenderFacts(facts);
    expect(summary.sampler).toBe('euler_ancestral/karras');
    expect(summary.steps).toBe('28');
  });

  it('formats lora and controlnet summaries', () => {
    const facts = extractRenderFacts(CHECKPOINT_LORA_CONTROLNET_GRAPH);
    const summary = summarizeRenderFacts(facts);
    expect(summary.lora).toBe('detail.safetensors@0.8/0.6');
    expect(summary.controlnet).toBe('openpose.safetensors@0.7 [0-0.8]');
  });
});

describe('promptDelta', () => {
  it('returns null when the two prompts are equal after trim, or both null', () => {
    expect(promptDelta('1girl, outdoors', '1girl, outdoors')).toBeNull();
    expect(promptDelta('  1girl, outdoors  ', '1girl, outdoors')).toBeNull();
    expect(promptDelta(null, null)).toBeNull();
  });

  it('marks a newly added token with a leading +', () => {
    expect(promptDelta('1girl, outdoors', '1girl, outdoors, smiling')).toBe('+smiling');
  });

  it('marks a removed token with a leading -', () => {
    expect(promptDelta('1girl, outdoors, smiling', '1girl, outdoors')).toBe('-smiling');
  });

  it('formats a weight-only change as w:(token before→after)', () => {
    expect(promptDelta('1girl, (a:1)', '1girl, (a:1.2)')).toBe('w:(a 1→1.2)');
  });

  it('combines added and removed sections with a middle dot', () => {
    expect(promptDelta('1girl, old_tag', '1girl, new_tag')).toBe('+new_tag · -old_tag');
  });

  it('renders a short token-count summary when one side is null', () => {
    expect(promptDelta(null, '1girl, outdoors, smiling')).toBe('(none) → 3 tokens');
    expect(promptDelta('1girl, outdoors', null)).toBe('2 tokens → (none)');
  });
});

describe('diffFactSummaries', () => {
  it('orders RENDER_FACT_COLUMNS keys first, then remaining keys sorted, and skips equal values', () => {
    const baseline = { checkpoint: 'a', sampler: 'x', 'variables.foo': '1' };
    const arm = { checkpoint: 'b', sampler: 'x', 'variables.foo': '2', 'variables.bar': '3' };
    expect(diffFactSummaries(baseline, arm)).toEqual([
      { column: 'checkpoint', baseline: 'a', arm: 'b' },
      { column: 'variables.bar', baseline: null, arm: '3' },
      { column: 'variables.foo', baseline: '1', arm: '2' },
    ]);
  });

  it('returns an empty list when nothing differs', () => {
    expect(diffFactSummaries({ checkpoint: 'a' }, { checkpoint: 'a' })).toEqual([]);
  });

  it('orders positive/negative after RENDER_FACT_COLUMNS and before variables.*, attaching a delta', () => {
    const baseline = { checkpoint: 'a', positive: '1girl, old_tag', negative: 'bad', 'variables.foo': '1' };
    const arm = { checkpoint: 'a', positive: '1girl, new_tag', negative: 'bad', 'variables.foo': '2' };
    expect(diffFactSummaries(baseline, arm)).toEqual([
      { column: 'positive', baseline: '1girl, old_tag', arm: '1girl, new_tag', delta: '+new_tag · -old_tag' },
      { column: 'variables.foo', baseline: '1', arm: '2' },
    ]);
  });
});
