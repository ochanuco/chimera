// ComfyUI プロンプトグラフ (API format `{ "<node_id>": { class_type, inputs } }`) から
// 「何で生成したか」を横断比較できる形に抽出する。値は常にリテラルか、他ノードへの参照
// `[node_id, output_index]` のどちらか — 参照はスカラー欄では null 扱いにする。v2 では
// prompt（positive/negative のテキスト）と各サンプラーの latent 由来（empty / upscale /
// 前段 KSampler からの継続）もグラフをたどって解決する（depth <= 8、循環ガード付き）。
//
// この中核部分 (extract/summarize/diff) は D1 に触れない純関数で、D1 を要する
// lazy-extraction ヘルパー (renderFactsForJob / resolveBatchRenderFacts) は下部に置く。
// どちらも同じファイルにあるが、前者は D1Database 型を一切参照しないので
// cloudflare:test なしの素の vitest からも import できる。

import { chunk, D1_MAX_BOUND_PARAMS } from './db';
import { tokenizePrompt, diffTokens } from './prompt-tokens';
import type { ComfyJobRow } from '../types';

export const RENDER_FACTS_VERSION = 2;

export interface RenderPrompt {
  positive: string | null;
  negative: string | null;
}

export interface RenderLatentSource {
  kind: 'empty' | 'latent_upscale' | 'image_upscale' | 'other';
  width: number | null;
  height: number | null;
  upscale_method: string | null; // LatentUpscale / ImageScale(By).upscale_method
  scale_by: number | null; // *By variants
  from_node_id: string | null; // the KSampler this pass continues from (chain), else null
}

export interface RenderSampler {
  node_id: string;
  steps: number | null;
  cfg: number | null;
  sampler_name: string | null;
  scheduler: string | null;
  denoise: number | null;
  seed: number | null;
  prompt: RenderPrompt;
  latent: RenderLatentSource | null;
}

export interface RenderSize {
  width: number;
  height: number;
}

export interface RenderLora {
  lora_name: string;
  strength_model: number | null;
  strength_clip: number | null;
}

export interface RenderControlNet {
  control_net_name: string;
  strength: number | null;
  start_percent: number | null;
  end_percent: number | null;
}

export interface RenderFacts {
  version: number;
  checkpoints: string[];
  models: { clip: string[]; vae: string | null };
  samplers: RenderSampler[];
  canvas: { width: number | null; height: number | null; final_size: RenderSize | null } | null;
  loras: RenderLora[];
  controlnets: RenderControlNet[];
  seed: number | null;
  output: { filename_prefix: string | null };
}

const EMPTY_FACTS: RenderFacts = {
  version: RENDER_FACTS_VERSION,
  checkpoints: [],
  models: { clip: [], vae: null },
  samplers: [],
  canvas: null,
  loras: [],
  controlnets: [],
  seed: null,
  output: { filename_prefix: null },
};

interface GraphNode {
  node_id: string;
  class_type: string;
  inputs: Record<string, unknown>;
}

const MAX_RESOLVE_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asFiniteInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Node ids sort by leading integer, then lexicographically for a hires suffix ("6b" after "6"). */
function nodeIdSortKey(id: string): [number, string] {
  const match = /^(\d+)(.*)$/.exec(id);
  if (!match) return [Number.POSITIVE_INFINITY, id];
  return [Number(match[1]), match[2] ?? ''];
}

function compareNodeIds(a: string, b: string): number {
  const [an, as] = nodeIdSortKey(a);
  const [bn, bs] = nodeIdSortKey(b);
  if (an !== bn) return an - bn;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function parseNodes(graph: unknown): GraphNode[] {
  if (!isRecord(graph)) return [];
  const nodes: GraphNode[] = [];
  for (const [nodeId, value] of Object.entries(graph)) {
    if (!isRecord(value)) continue;
    const classType = asNonEmptyString(value.class_type);
    if (!classType) continue;
    const inputs = isRecord(value.inputs) ? value.inputs : {};
    nodes.push({ node_id: nodeId, class_type: classType, inputs });
  }
  return nodes.sort((a, b) => compareNodeIds(a.node_id, b.node_id));
}

function nodeRef(value: unknown): string | null {
  return Array.isArray(value) && value.length >= 1 && typeof value[0] === 'string' ? value[0] : null;
}

const CHECKPOINT_FIELD_BY_CLASS: Record<string, string> = {
  CheckpointLoaderSimple: 'ckpt_name',
  DiffusersLoader: 'model_path',
  UNETLoader: 'unet_name',
};

function extractCheckpoints(nodes: GraphNode[]): string[] {
  const checkpoints: string[] = [];
  for (const node of nodes) {
    const field = CHECKPOINT_FIELD_BY_CLASS[node.class_type];
    if (!field) continue;
    const name = asNonEmptyString(node.inputs[field]);
    if (name) checkpoints.push(name);
  }
  // Dedupe exact duplicates, keeping first-occurrence order.
  return Array.from(new Set(checkpoints));
}

function extractModels(nodes: GraphNode[]): RenderFacts['models'] {
  const clip: string[] = [];
  let vae: string | null = null;
  for (const node of nodes) {
    if (node.class_type === 'CLIPLoader') {
      const name = asNonEmptyString(node.inputs.clip_name);
      if (name) clip.push(name);
    } else if (node.class_type === 'DualCLIPLoader') {
      const name1 = asNonEmptyString(node.inputs.clip_name1);
      const name2 = asNonEmptyString(node.inputs.clip_name2);
      if (name1) clip.push(name1);
      if (name2) clip.push(name2);
    } else if (node.class_type === 'VAELoader' && vae === null) {
      vae = asNonEmptyString(node.inputs.vae_name);
    }
  }
  return { clip, vae };
}

function extractOutput(nodes: GraphNode[]): RenderFacts['output'] {
  const save = nodes.find((n) => n.class_type === 'SaveImage') ?? null;
  return { filename_prefix: save ? asNonEmptyString(save.inputs.filename_prefix) : null };
}

/** Walks upstream through samples / image / images / pixels / latent_image inputs until a KSampler(Advanced) node id, or null (depth-bounded, cycle-safe). */
function resolveSamplerOrigin(
  nodeMap: Map<string, GraphNode>,
  ref: unknown,
  depth = 0,
  visited: Set<string> = new Set(),
): string | null {
  if (depth > MAX_RESOLVE_DEPTH) return null;
  const nodeId = nodeRef(ref);
  if (nodeId === null || visited.has(nodeId)) return null;
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') return node.node_id;

  visited.add(nodeId);
  const next = node.inputs.samples ?? node.inputs.image ?? node.inputs.images ?? node.inputs.pixels ?? node.inputs.latent_image;
  return resolveSamplerOrigin(nodeMap, next, depth + 1, visited);
}

/** Resolves a KSampler(Advanced) latent_image input into how that pass's canvas originated (depth-bounded via resolveSamplerOrigin). */
function resolveLatentSource(nodeMap: Map<string, GraphNode>, ref: unknown): RenderLatentSource | null {
  const nodeId = nodeRef(ref);
  if (nodeId === null) return null;
  const node = nodeMap.get(nodeId);
  if (!node) return null;

  if (node.class_type === 'EmptyLatentImage') {
    return {
      kind: 'empty',
      width: asFiniteNumber(node.inputs.width),
      height: asFiniteNumber(node.inputs.height),
      upscale_method: null,
      scale_by: null,
      from_node_id: null,
    };
  }
  if (node.class_type === 'LatentUpscale') {
    return {
      kind: 'latent_upscale',
      width: asFiniteNumber(node.inputs.width),
      height: asFiniteNumber(node.inputs.height),
      upscale_method: asNonEmptyString(node.inputs.upscale_method),
      scale_by: null,
      from_node_id: resolveSamplerOrigin(nodeMap, node.inputs.samples),
    };
  }
  if (node.class_type === 'LatentUpscaleBy') {
    return {
      kind: 'latent_upscale',
      width: null,
      height: null,
      upscale_method: asNonEmptyString(node.inputs.upscale_method),
      scale_by: asFiniteNumber(node.inputs.scale_by),
      from_node_id: resolveSamplerOrigin(nodeMap, node.inputs.samples),
    };
  }
  if (node.class_type === 'VAEEncode') {
    const pixelsId = nodeRef(node.inputs.pixels);
    const pixelsNode = pixelsId ? nodeMap.get(pixelsId) ?? null : null;
    if (pixelsNode && (pixelsNode.class_type === 'ImageScale' || pixelsNode.class_type === 'ImageScaleBy')) {
      const isBy = pixelsNode.class_type === 'ImageScaleBy';
      return {
        kind: 'image_upscale',
        width: isBy ? null : asFiniteNumber(pixelsNode.inputs.width),
        height: isBy ? null : asFiniteNumber(pixelsNode.inputs.height),
        upscale_method: asNonEmptyString(pixelsNode.inputs.upscale_method),
        scale_by: isBy ? asFiniteNumber(pixelsNode.inputs.scale_by) : null,
        from_node_id: resolveSamplerOrigin(nodeMap, pixelsNode.inputs.image),
      };
    }
  }

  // Anything else upstream of a sampler (a VAEEncode without a recognized scale node, a
  // passthrough node, ...): keep only where it continues from, no size/method facts.
  const origin = resolveSamplerOrigin(nodeMap, ref);
  return origin ? { kind: 'other', width: null, height: null, upscale_method: null, scale_by: null, from_node_id: origin } : null;
}

const CONDITIONING_PASSTHROUGH_CLASSES = new Set(['ConditioningCombine', 'ConditioningConcat', 'ConditioningSetTimestepRange']);

function isConditioningSetArea(classType: string): boolean {
  return classType.startsWith('ConditioningSetArea');
}

/**
 * Resolves a KSampler(Advanced) positive/negative input into its prompt text, following
 * CLIPTextEncode (one extra hop when `text` is itself a reference), ControlNetApply(Advanced),
 * and Conditioning combinators. depth-bounded (<=8) and cycle-safe; anything unrecognized -> null.
 */
function resolvePromptText(
  nodeMap: Map<string, GraphNode>,
  ref: unknown,
  polarity: 'positive' | 'negative',
  depth = 0,
  visited: Set<string> = new Set(),
): string | null {
  if (depth > MAX_RESOLVE_DEPTH) return null;
  const nodeId = nodeRef(ref);
  if (nodeId === null || visited.has(nodeId)) return null;
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  visited.add(nodeId);

  if (node.class_type === 'CLIPTextEncode') {
    const text = node.inputs.text;
    if (typeof text === 'string') return text;
    const hopId = nodeRef(text);
    if (hopId === null) return null;
    const hopNode = nodeMap.get(hopId);
    if (!hopNode) return null;
    const value = hopNode.inputs.text ?? hopNode.inputs.value ?? hopNode.inputs.string;
    return typeof value === 'string' ? value : null;
  }
  if (node.class_type === 'ControlNetApply') {
    return resolvePromptText(nodeMap, node.inputs.conditioning, polarity, depth + 1, visited);
  }
  if (node.class_type === 'ControlNetApplyAdvanced') {
    return resolvePromptText(nodeMap, node.inputs[polarity], polarity, depth + 1, visited);
  }
  if (CONDITIONING_PASSTHROUGH_CLASSES.has(node.class_type) || isConditioningSetArea(node.class_type)) {
    const next = node.inputs.conditioning_1 ?? node.inputs.conditioning_to ?? node.inputs.conditioning;
    return resolvePromptText(nodeMap, next, polarity, depth + 1, visited);
  }
  return null;
}

function extractSamplers(nodes: GraphNode[], nodeMap: Map<string, GraphNode>): RenderSampler[] {
  const samplers: RenderSampler[] = [];
  for (const node of nodes) {
    if (node.class_type === 'KSampler') {
      samplers.push({
        node_id: node.node_id,
        steps: asFiniteNumber(node.inputs.steps),
        cfg: asFiniteNumber(node.inputs.cfg),
        sampler_name: asNonEmptyString(node.inputs.sampler_name),
        scheduler: asNonEmptyString(node.inputs.scheduler),
        denoise: asFiniteNumber(node.inputs.denoise),
        seed: asFiniteInt(node.inputs.seed),
        prompt: {
          positive: resolvePromptText(nodeMap, node.inputs.positive, 'positive'),
          negative: resolvePromptText(nodeMap, node.inputs.negative, 'negative'),
        },
        latent: resolveLatentSource(nodeMap, node.inputs.latent_image),
      });
    } else if (node.class_type === 'KSamplerAdvanced') {
      samplers.push({
        node_id: node.node_id,
        steps: asFiniteNumber(node.inputs.steps),
        cfg: asFiniteNumber(node.inputs.cfg),
        sampler_name: asNonEmptyString(node.inputs.sampler_name),
        scheduler: asNonEmptyString(node.inputs.scheduler),
        denoise: null,
        seed: asFiniteInt(node.inputs.noise_seed),
        prompt: {
          positive: resolvePromptText(nodeMap, node.inputs.positive, 'positive'),
          negative: resolvePromptText(nodeMap, node.inputs.negative, 'negative'),
        },
        latent: resolveLatentSource(nodeMap, node.inputs.latent_image),
      });
    }
  }
  return samplers;
}

const SCALE_LITERAL_CLASSES = new Set(['LatentUpscale', 'ImageScale']);
const SCALE_BY_CLASSES = new Set(['LatentUpscaleBy', 'ImageScaleBy']);

function extractCanvas(nodes: GraphNode[]): RenderFacts['canvas'] {
  const emptyLatent = nodes.find((n) => n.class_type === 'EmptyLatentImage') ?? null;
  const baseWidth = emptyLatent ? asFiniteNumber(emptyLatent.inputs.width) : null;
  const baseHeight = emptyLatent ? asFiniteNumber(emptyLatent.inputs.height) : null;

  const scaleNodes = nodes.filter((n) => SCALE_LITERAL_CLASSES.has(n.class_type) || SCALE_BY_CLASSES.has(n.class_type));
  const lastScale = scaleNodes.length > 0 ? scaleNodes[scaleNodes.length - 1]! : null;

  let finalSize: RenderSize | null = null;
  if (lastScale && SCALE_LITERAL_CLASSES.has(lastScale.class_type)) {
    const w = asFiniteNumber(lastScale.inputs.width);
    const h = asFiniteNumber(lastScale.inputs.height);
    if (w !== null && h !== null) finalSize = { width: w, height: h };
  } else if (lastScale && SCALE_BY_CLASSES.has(lastScale.class_type)) {
    const scaleBy = asFiniteNumber(lastScale.inputs.scale_by);
    if (scaleBy !== null && baseWidth !== null && baseHeight !== null) {
      finalSize = { width: Math.round(baseWidth * scaleBy), height: Math.round(baseHeight * scaleBy) };
    }
  }

  if (emptyLatent) return { width: baseWidth, height: baseHeight, final_size: finalSize };
  if (finalSize) return { width: null, height: null, final_size: finalSize };
  return null;
}

function extractLoras(nodes: GraphNode[]): RenderLora[] {
  const loras: RenderLora[] = [];
  for (const node of nodes) {
    if (node.class_type === 'LoraLoader') {
      const name = asNonEmptyString(node.inputs.lora_name);
      if (!name) continue;
      loras.push({
        lora_name: name,
        strength_model: asFiniteNumber(node.inputs.strength_model),
        strength_clip: asFiniteNumber(node.inputs.strength_clip),
      });
    } else if (node.class_type === 'LoraLoaderModelOnly') {
      const name = asNonEmptyString(node.inputs.lora_name);
      if (!name) continue;
      loras.push({
        lora_name: name,
        strength_model: asFiniteNumber(node.inputs.strength_model),
        strength_clip: null,
      });
    }
  }
  return loras;
}

function extractControlNets(nodes: GraphNode[]): RenderControlNet[] {
  const loaders = nodes.filter((n) => n.class_type === 'ControlNetLoader');
  const loaderById = new Map(loaders.map((n) => [n.node_id, n]));
  const applies = nodes.filter((n) => n.class_type === 'ControlNetApplyAdvanced' || n.class_type === 'ControlNetApply');

  const usedLoaderIds = new Set<string>();
  const result: RenderControlNet[] = [];

  applies.forEach((node, index) => {
    const refId = nodeRef(node.inputs.control_net);
    let loader = refId ? loaderById.get(refId) ?? null : null;
    if (!loader) loader = loaders[index] ?? null;
    if (loader) usedLoaderIds.add(loader.node_id);
    const name = loader ? asNonEmptyString(loader.inputs.control_net_name) : null;
    if (!name) return;

    const isAdvanced = node.class_type === 'ControlNetApplyAdvanced';
    result.push({
      control_net_name: name,
      strength: asFiniteNumber(node.inputs.strength),
      start_percent: isAdvanced ? asFiniteNumber(node.inputs.start_percent) : null,
      end_percent: isAdvanced ? asFiniteNumber(node.inputs.end_percent) : null,
    });
  });

  for (const loader of loaders) {
    if (usedLoaderIds.has(loader.node_id)) continue;
    const name = asNonEmptyString(loader.inputs.control_net_name);
    if (!name) continue;
    result.push({ control_net_name: name, strength: null, start_percent: null, end_percent: null });
  }

  return result;
}

function extractSeed(nodes: GraphNode[]): number | null {
  for (const node of nodes) {
    if (node.class_type === 'KSampler') {
      const seed = asFiniteInt(node.inputs.seed);
      if (seed !== null) return seed;
    } else if (node.class_type === 'KSamplerAdvanced') {
      const seed = asFiniteInt(node.inputs.noise_seed);
      if (seed !== null) return seed;
    }
  }
  return null;
}

export function extractRenderFacts(graph: unknown): RenderFacts {
  const nodes = parseNodes(graph);
  if (nodes.length === 0) return EMPTY_FACTS;
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  return {
    version: RENDER_FACTS_VERSION,
    checkpoints: extractCheckpoints(nodes),
    models: extractModels(nodes),
    samplers: extractSamplers(nodes, nodeMap),
    canvas: extractCanvas(nodes),
    loras: extractLoras(nodes),
    controlnets: extractControlNets(nodes),
    seed: extractSeed(nodes),
    output: extractOutput(nodes),
  };
}

export const RENDER_FACT_COLUMNS = ['checkpoint', 'sampler', 'steps', 'cfg', 'denoise', 'canvas', 'lora', 'controlnet'] as const;
export type RenderFactColumn = (typeof RENDER_FACT_COLUMNS)[number];

/** Joins per-sampler strings with " → ", collapsing to a single value when every sampler agrees. */
function joinPerSampler(values: string[]): string | null {
  if (values.length === 0) return null;
  return new Set(values).size === 1 ? values[0]! : values.join(' → ');
}

function formatNumberOrUnknown(value: number | null): string {
  return value === null ? '?' : String(value);
}

export function summarizeRenderFacts(facts: RenderFacts | null): Record<RenderFactColumn, string | null> {
  if (!facts) {
    return { checkpoint: null, sampler: null, steps: null, cfg: null, denoise: null, canvas: null, lora: null, controlnet: null };
  }

  const checkpoint = facts.checkpoints.length > 0 ? facts.checkpoints.join(', ') : null;

  const sampler = joinPerSampler(facts.samplers.map((s) => `${s.sampler_name ?? '?'}/${s.scheduler ?? '?'}`));
  const steps = joinPerSampler(facts.samplers.map((s) => formatNumberOrUnknown(s.steps)));
  const cfg = joinPerSampler(facts.samplers.map((s) => formatNumberOrUnknown(s.cfg)));
  const denoise =
    facts.samplers.length > 0 ? formatNumberOrUnknown(facts.samplers[facts.samplers.length - 1]!.denoise) : null;

  let canvas: string | null = null;
  if (facts.canvas) {
    canvas = `${formatNumberOrUnknown(facts.canvas.width)}x${formatNumberOrUnknown(facts.canvas.height)}`;
    if (facts.canvas.final_size) {
      canvas += ` → ${facts.canvas.final_size.width}x${facts.canvas.final_size.height}`;
    }
  }

  const lora =
    facts.loras.length > 0
      ? facts.loras
          .map((l) => {
            let s = `${l.lora_name}@${formatNumberOrUnknown(l.strength_model)}`;
            if (l.strength_clip !== null && l.strength_clip !== l.strength_model) s += `/${l.strength_clip}`;
            return s;
          })
          .join(', ')
      : null;

  const controlnet =
    facts.controlnets.length > 0
      ? facts.controlnets
          .map((cn) => {
            let s = `${cn.control_net_name}@${formatNumberOrUnknown(cn.strength)}`;
            if (cn.start_percent !== null && cn.end_percent !== null) s += ` [${cn.start_percent}-${cn.end_percent}]`;
            return s;
          })
          .join(', ')
      : null;

  return { checkpoint, sampler, steps, cfg, denoise, canvas, lora, controlnet };
}

const PROMPT_DELTA_MAX_LENGTH = 120;

function capDelta(s: string): string {
  return s.length > PROMPT_DELTA_MAX_LENGTH ? `${s.slice(0, PROMPT_DELTA_MAX_LENGTH - 1)}…` : s;
}

function tokenCount(text: string): string {
  const n = tokenizePrompt(text).length;
  return `${n} token${n === 1 ? '' : 's'}`;
}

/** Compact token-level delta between two prompt texts, null when equal (after trim) or both null. */
export function promptDelta(baseline: string | null, arm: string | null): string | null {
  const baselineTrimmed = baseline === null ? null : baseline.trim();
  const armTrimmed = arm === null ? null : arm.trim();
  if (baselineTrimmed === armTrimmed) return null;

  if (baselineTrimmed === null || baselineTrimmed.length === 0) {
    return capDelta(`(none) → ${tokenCount(armTrimmed ?? '')}`);
  }
  if (armTrimmed === null || armTrimmed.length === 0) {
    return capDelta(`${tokenCount(baselineTrimmed)} → (none)`);
  }

  const baseTokens = tokenizePrompt(baselineTrimmed);
  const armTokens = tokenizePrompt(armTrimmed);
  const { tokens, removed } = diffTokens(armTokens, baseTokens);

  const addedOrChanged = tokens
    .filter((t) => t.diff === 'added' || t.diff === 'weight')
    .map((t) => (t.diff === 'added' ? `+${t.text}` : `w:(${t.text} ${t.parentWeight}→${t.weight})`));
  const removedParts = removed.map((t) => `-${t.text}`);

  const sections = [addedOrChanged.join(', '), removedParts.join(', ')].filter((s) => s.length > 0);
  if (sections.length === 0) return null;
  return capDelta(sections.join(' · '));
}

export interface FactDiffEntry {
  column: string;
  baseline: string | null;
  arm: string | null;
  delta?: string;
}

const PROMPT_DIFF_KEYS = ['positive', 'negative'] as const;

/** Diffs every key of the union of both summaries; RENDER_FACT_COLUMNS come first, then positive/negative, then the rest sorted. */
export function diffFactSummaries(
  baseline: Record<string, string | null>,
  arm: Record<string, string | null>,
): FactDiffEntry[] {
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(arm)]);
  const factColumns = (RENDER_FACT_COLUMNS as readonly string[]).filter((c) => allKeys.has(c));
  const promptColumns = PROMPT_DIFF_KEYS.filter((c) => allKeys.has(c));
  const excluded = new Set<string>([...RENDER_FACT_COLUMNS, ...PROMPT_DIFF_KEYS]);
  const remaining = Array.from(allKeys)
    .filter((k) => !excluded.has(k))
    .sort();

  const entries: FactDiffEntry[] = [];
  for (const key of [...factColumns, ...promptColumns, ...remaining]) {
    const baselineValue = baseline[key] ?? null;
    const armValue = arm[key] ?? null;
    if (baselineValue === armValue) continue;
    const entry: FactDiffEntry = { column: key, baseline: baselineValue, arm: armValue };
    if ((PROMPT_DIFF_KEYS as readonly string[]).includes(key)) {
      const delta = promptDelta(baselineValue, armValue);
      if (delta !== null) entry.delta = delta;
    }
    entries.push(entry);
  }
  return entries;
}

// --- D1 側: lazy extraction + cache 永続化 ---

/** render_facts_json を返す。未抽出 (NULL) または version が古ければ graph から再抽出して書き戻す。graph も無ければ null。 */
export async function renderFactsForJob(db: D1Database, job: ComfyJobRow): Promise<RenderFacts | null> {
  if (job.render_facts_json) {
    try {
      const cached = JSON.parse(job.render_facts_json) as RenderFacts;
      if ((cached.version ?? 0) >= RENDER_FACTS_VERSION) return cached;
    } catch {
      // 壊れたキャッシュは再抽出にフォールバックする。
    }
  }
  if (!job.graph) return null;

  const facts = extractRenderFacts(JSON.parse(job.graph));
  await db.prepare('UPDATE comfy_jobs SET render_facts_json = ? WHERE id = ?').bind(JSON.stringify(facts), job.id).run();
  return facts;
}

/** Batch ごとに job_index が最小で graph を持つ Job から render_facts を解決する。 */
export async function resolveBatchRenderFacts(db: D1Database, batchIds: string[]): Promise<Map<string, RenderFacts>> {
  const unique = Array.from(new Set(batchIds));
  const map = new Map<string, RenderFacts>();
  for (const part of chunk(unique, D1_MAX_BOUND_PARAMS)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT * FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY job_index ASC) AS rn
           FROM comfy_jobs
           WHERE batch_id IN (${placeholders}) AND graph IS NOT NULL
         ) WHERE rn = 1`,
      )
      .bind(...part)
      .all<ComfyJobRow>();
    for (const job of results ?? []) {
      const facts = await renderFactsForJob(db, job);
      if (facts) map.set(job.batch_id, facts);
    }
  }
  return map;
}
