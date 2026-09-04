// ComfyUI プロンプトグラフ (API format `{ "<node_id>": { class_type, inputs } }`) から
// 「何で生成したか」を横断比較できる形に抽出する。値は常にリテラルか、他ノードへの参照
// `[node_id, output_index]` のどちらか — 参照はスカラー欄では null 扱いにする（グラフを
// たどって解決するのは controlnet の control_net 参照だけ、docs/domain-model.md 参照）。
//
// この中核部分 (extract/summarize/diff) は D1 に触れない純関数で、D1 を要する
// lazy-extraction ヘルパー (renderFactsForJob / resolveBatchRenderFacts) は下部に置く。
// どちらも同じファイルにあるが、前者は D1Database 型を一切参照しないので
// cloudflare:test なしの素の vitest からも import できる。

import { chunk, D1_MAX_BOUND_PARAMS } from './db';
import type { ComfyJobRow } from '../types';

export interface RenderSampler {
  node_id: string;
  steps: number | null;
  cfg: number | null;
  sampler_name: string | null;
  scheduler: string | null;
  denoise: number | null;
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
  checkpoints: string[];
  samplers: RenderSampler[];
  canvas: { width: number | null; height: number | null; final_size: RenderSize | null } | null;
  loras: RenderLora[];
  controlnets: RenderControlNet[];
  seed: number | null;
}

const EMPTY_FACTS: RenderFacts = {
  checkpoints: [],
  samplers: [],
  canvas: null,
  loras: [],
  controlnets: [],
  seed: null,
};

interface GraphNode {
  node_id: string;
  class_type: string;
  inputs: Record<string, unknown>;
}

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

function extractSamplers(nodes: GraphNode[]): RenderSampler[] {
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
      });
    } else if (node.class_type === 'KSamplerAdvanced') {
      samplers.push({
        node_id: node.node_id,
        steps: asFiniteNumber(node.inputs.steps),
        cfg: asFiniteNumber(node.inputs.cfg),
        sampler_name: asNonEmptyString(node.inputs.sampler_name),
        scheduler: asNonEmptyString(node.inputs.scheduler),
        denoise: null,
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
  return {
    checkpoints: extractCheckpoints(nodes),
    samplers: extractSamplers(nodes),
    canvas: extractCanvas(nodes),
    loras: extractLoras(nodes),
    controlnets: extractControlNets(nodes),
    seed: extractSeed(nodes),
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

export interface FactDiffEntry {
  column: string;
  baseline: string | null;
  arm: string | null;
}

/** Diffs every key of the union of both summaries; RENDER_FACT_COLUMNS come first, then the rest sorted. */
export function diffFactSummaries(
  baseline: Record<string, string | null>,
  arm: Record<string, string | null>,
): FactDiffEntry[] {
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(arm)]);
  const factColumns = (RENDER_FACT_COLUMNS as readonly string[]).filter((c) => allKeys.has(c));
  const remaining = Array.from(allKeys)
    .filter((k) => !(RENDER_FACT_COLUMNS as readonly string[]).includes(k))
    .sort();

  const entries: FactDiffEntry[] = [];
  for (const key of [...factColumns, ...remaining]) {
    const baselineValue = baseline[key] ?? null;
    const armValue = arm[key] ?? null;
    if (baselineValue !== armValue) entries.push({ column: key, baseline: baselineValue, arm: armValue });
  }
  return entries;
}

// --- D1 側: lazy extraction + cache 永続化 ---

/** render_facts_json を返す。未抽出 (NULL) で graph があれば抽出して列に書き戻す。graph も無ければ null。 */
export async function renderFactsForJob(db: D1Database, job: ComfyJobRow): Promise<RenderFacts | null> {
  if (job.render_facts_json) {
    try {
      return JSON.parse(job.render_facts_json) as RenderFacts;
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
