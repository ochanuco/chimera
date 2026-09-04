import { describe, expect, it } from 'vitest';
import { diffFactSummaries, extractRenderFacts, summarizeRenderFacts, type RenderFacts } from '../src/lib/render-facts';

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
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
};

// 2. CheckpointLoaderSimple graph with a lora and an advanced controlnet application.
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

// 3. UNETLoader + CLIPLoader graph (no CheckpointLoaderSimple / DiffusersLoader at all).
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

// 4. chain_pass graph: first pass DiffusersLoader "4", literal ImageScale upscale, second pass
// against a different DiffusersLoader ("20"), hires clip node "6b".
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
      positive: ['6b', 0],
      negative: ['6b', 0],
      latent_image: ['5', 0],
    },
  },
  '4': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-v3' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  '6b': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
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
      negative: ['6b', 0],
      latent_image: ['11', 0],
    },
  },
  '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['20', 2] } },
  '20': { class_type: 'DiffusersLoader', inputs: { model_path: 'yukari-finalize' } },
};

const EMPTY_FACTS: RenderFacts = { checkpoints: [], samplers: [], canvas: null, loras: [], controlnets: [], seed: null };

describe('extractRenderFacts', () => {
  it('extracts a single-pass DiffusersLoader graph', () => {
    expect(extractRenderFacts(DIFFUSERS_GRAPH)).toEqual({
      checkpoints: ['yukari-v3'],
      samplers: [{ node_id: '3', steps: 28, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'karras', denoise: 1 }],
      canvas: { width: 832, height: 1216, final_size: null },
      loras: [],
      controlnets: [],
      seed: 1234,
    });
  });

  it('extracts a CheckpointLoaderSimple graph with a lora and an advanced controlnet', () => {
    expect(extractRenderFacts(CHECKPOINT_LORA_CONTROLNET_GRAPH)).toEqual({
      checkpoints: ['model.safetensors'],
      samplers: [{ node_id: '3', steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 }],
      canvas: { width: 512, height: 512, final_size: null },
      loras: [{ lora_name: 'detail.safetensors', strength_model: 0.8, strength_clip: 0.6 }],
      controlnets: [{ control_net_name: 'openpose.safetensors', strength: 0.7, start_percent: 0, end_percent: 0.8 }],
      seed: 1,
    });
  });

  it('extracts checkpoints from UNETLoader when there is no CheckpointLoaderSimple/DiffusersLoader', () => {
    expect(extractRenderFacts(UNET_CLIP_GRAPH)).toEqual({
      checkpoints: ['anima.safetensors'],
      samplers: [{ node_id: '3', steps: 25, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 }],
      canvas: { width: 1024, height: 1024, final_size: null },
      loras: [],
      controlnets: [],
      seed: 99,
    });
  });

  it('extracts a chain_pass graph: two checkpoints, two samplers in node-id order, literal final_size', () => {
    expect(extractRenderFacts(CHAIN_PASS_GRAPH)).toEqual({
      checkpoints: ['yukari-v3', 'yukari-finalize'],
      samplers: [
        { node_id: '3', steps: 28, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'karras', denoise: 1 },
        { node_id: '12', steps: 20, cfg: 4, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 0.45 },
      ],
      canvas: { width: 832, height: 1216, final_size: { width: 1248, height: 1824 } },
      loras: [],
      controlnets: [],
      seed: 1234,
    });
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
});
