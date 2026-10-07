// /compare と Experiment Detail の Compare 表が共有する、Generation 行 -> CompareItem の組み立て。

import { MAX_GENERATION_IDS, queryGenerations } from './generations';
import { parseJsonArray } from './preset-references';
import { renderFactsForJob } from './render-facts';
import type { GenerationCardData } from '../ui/components/GenerationCard';
import type { CompareItem, CompareSemantic } from '../ui/pages/Compare';
import type { ComfyJobRow, GenerationRow } from '../types';

/** Parses a Generation's semantic_json into CompareSemantic; NULL or unparseable JSON is treated as "not analyzed". */
function parseCompareSemantic(row: GenerationRow): CompareSemantic | null {
  if (!row.semantic_json) return null;
  try {
    const parsed = JSON.parse(row.semantic_json) as {
      core?: Partial<CompareSemantic['core']>;
      strengths?: string[];
      defects?: string[];
      attributes?: Record<string, unknown>;
    };
    return {
      summary: row.summary,
      core: {
        pose: parsed.core?.pose ?? null,
        expression: parsed.core?.expression ?? null,
        outfit: parsed.core?.outfit ?? null,
        style: parsed.core?.style ?? null,
        composition: parsed.core?.composition ?? null,
      },
      strengths: parsed.strengths ?? [],
      defects: parsed.defects ?? [],
      attributes: parsed.attributes ?? {},
    };
  } catch {
    return null;
  }
}

/** rows と同じ順の CompareItem。カード用の項目は Gallery/Bookmarks と同じ queryGenerations から取る (docs/ui.md「Compare」)。 */
export async function buildCompareItems(db: D1Database, rows: GenerationRow[], origin: string): Promise<CompareItem[]> {
  if (rows.length === 0) return [];

  const requestIds = Array.from(new Set(rows.map((row) => row.request_id).filter((id): id is string => id !== null)));
  const requestChangesById = new Map<string, { raw_instruction: string | null; patches_json: string | null }>();
  if (requestIds.length > 0) {
    const placeholders = requestIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, raw_instruction, patches_json FROM requests WHERE id IN (${placeholders})`)
      .bind(...requestIds)
      .all<{ id: string; raw_instruction: string | null; patches_json: string | null }>();
    for (const r of results ?? []) requestChangesById.set(r.id, r);
  }

  const jobIds = Array.from(new Set(rows.map((row) => row.comfy_job_id)));
  const jobsById = new Map<string, ComfyJobRow>();
  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM comfy_jobs WHERE id IN (${placeholders})`)
      .bind(...jobIds)
      .all<ComfyJobRow>();
    for (const j of results ?? []) jobsById.set(j.id, j);
  }
  const renderFactsByGenerationId = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const job = jobsById.get(row.comfy_job_id);
        return [row.id, job ? await renderFactsForJob(db, job) : null] as const;
      }),
    ),
  );

  const cardData = await queryGenerations(db, { ids: rows.map((row) => row.id).join(',') }, origin);
  const cardByGenerationId = new Map(cardData.items.map((item) => [item.id, item]));

  return rows.map((row) => {
    const card = cardByGenerationId.get(row.id);
    if (!card) throw new Error(`generation ${row.id} missing from its own queryGenerations lookup`);
    const changes = row.request_id ? requestChangesById.get(row.request_id) : undefined;
    return {
      ...card,
      seed: row.seed,
      created_at: row.created_at,
      raw_instruction: changes?.raw_instruction ?? null,
      patches: parseJsonArray(changes?.patches_json ?? null),
      semantic: parseCompareSemantic(row),
      render_facts: renderFactsByGenerationId.get(row.id) ?? null,
    };
  });
}

/** Compare 表に載せる Run 数の上限（/compare の列数上限と同じ）。 */
export const EXPERIMENT_COMPARE_MAX_COLUMNS = 9;

export interface ExperimentCompareRun {
  id: string;
  run_index: number;
  objective: string | null;
  overrides: Record<string, unknown>;
  variables: Record<string, string | number> | null;
  request: { id: string } | null;
}

/** Gallery と同じ GenerationCard に渡すデータ（safety・bookmark・寸法などを含む）。 */
export type ExperimentMatrixCell = GenerationCardData;

export interface ExperimentMatrix {
  /** seed 列。base_parameters.seeds の順、続けて Run の Generation にだけ現れる seed（出現順）。 */
  seeds: number[];
  /** Run を run_index 順に 1 行。cells は seeds と同じ順で、Generation が無ければ null。 */
  rows: { label: string; cells: (ExperimentMatrixCell | null)[] }[];
}

export interface ExperimentCompare {
  /** Run（行）× seed（列）の全 Generation。 */
  matrix: ExperimentMatrix;
  /** Run 列と同じ順。結果の無い Run は placeholder の CompareItem。 */
  items: CompareItem[];
  headers: string[];
  /** 全 Run の Generation に現れる seed（出現順）。 */
  seeds: number[];
  selectedSeed: number | null;
  /** 表に載らなかった Run 数。 */
  omittedRuns: number;
}

/** `?seed=` の値。整数でなければ null。 */
export function parseSeedQuery(raw: string | undefined): number | null {
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

function baseSeeds(baseParameters: Record<string, unknown> | null): number[] {
  const seeds = baseParameters?.seeds;
  return Array.isArray(seeds) ? seeds.filter((n): n is number => Number.isInteger(n)) : [];
}

function placeholderItem(): CompareItem {
  return {
    id: '',
    short_id: '',
    image_url: '',
    thumbnail_url: '',
    rating: null,
    bookmark: false,
    seed: null,
    created_at: '',
    raw_instruction: null,
    patches: [],
    semantic: null,
    render_facts: null,
    placeholder: true,
  };
}

/**
 * Experiment の Run を列にした Compare 用データ。各列の Generation は選んだ seed と同じ seed の Generation
 * （無ければ placeholder。別の seed の画像を並べると比較にならないため、代わりの Generation は出さない）。変更点の行は Generation の Request ではなく Run の
 * objective / overrides.patches から取る。
 */
export async function buildExperimentCompare(
  db: D1Database,
  runs: ExperimentCompareRun[],
  baseParameters: Record<string, unknown> | null,
  seedQuery: number | null,
  origin: string,
): Promise<ExperimentCompare> {
  const columns = [...runs].sort((a, b) => a.run_index - b.run_index).slice(0, EXPERIMENT_COMPARE_MAX_COLUMNS);

  const requestIds = columns.map((run) => run.request?.id).filter((id): id is string => Boolean(id));
  const generationsByRequest = new Map<string, GenerationRow[]>();
  if (requestIds.length > 0) {
    const placeholders = requestIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM generations WHERE request_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .bind(...requestIds)
      .all<GenerationRow>();
    for (const row of results ?? []) {
      const list = generationsByRequest.get(row.request_id!) ?? [];
      list.push(row);
      generationsByRequest.set(row.request_id!, list);
    }
  }
  const generationsOf = (run: ExperimentCompareRun) => (run.request ? generationsByRequest.get(run.request.id) ?? [] : []);

  const seeds: number[] = [];
  for (const run of columns) {
    for (const g of generationsOf(run)) {
      if (g.seed !== null && !seeds.includes(g.seed)) seeds.push(g.seed);
    }
  }

  const matrixSeeds = [...new Set([...baseSeeds(baseParameters), ...seeds])];
  const headerOf = (run: ExperimentCompareRun) => {
    const arm = run.variables?.arm;
    return arm !== undefined ? String(arm) : `#${run.run_index}`;
  };
  const allGenerations = columns.flatMap(generationsOf);
  const cardById = new Map<string, GenerationCardData>();
  // queryGenerations の ids は 1 回 MAX_GENERATION_IDS 件まで（9 × 16 = 144 セルなら 2 回）。
  const idChunks: string[][] = [];
  for (let i = 0; i < allGenerations.length; i += MAX_GENERATION_IDS) {
    idChunks.push(allGenerations.slice(i, i + MAX_GENERATION_IDS).map((g) => g.id));
  }
  const cardPages = await Promise.all(
    idChunks.map((chunk) => queryGenerations(db, { ids: chunk.join(','), limit: String(chunk.length) }, origin)),
  );
  for (const page of cardPages) for (const item of page.items) cardById.set(item.id, item);

  const matrix: ExperimentMatrix = {
    seeds: matrixSeeds,
    rows: columns.map((run) => ({
      label: headerOf(run),
      cells: matrixSeeds.map((seed) => {
        const g = generationsOf(run).find((row) => row.seed === seed);
        return (g ? cardById.get(g.id) : undefined) ?? null;
      }),
    })),
  };

  const firstGeneration = columns.map((run) => generationsOf(run)[0]).find((g) => g !== undefined);
  const selectedSeed = seedQuery ?? baseSeeds(baseParameters)[0] ?? firstGeneration?.seed ?? null;

  const chosen = columns.map((run) => {
    const rows = generationsOf(run);
    if (selectedSeed === null) return rows[0] ?? null;
    return rows.find((g) => g.seed === selectedSeed) ?? null;
  });
  const builtItems = await buildCompareItems(
    db,
    chosen.filter((g): g is GenerationRow => g !== null),
    origin,
  );
  const builtById = new Map(builtItems.map((item) => [item.id, item]));

  const items = columns.map((run, i) => {
    const generation = chosen[i];
    const item = (generation ? builtById.get(generation.id) : null) ?? placeholderItem();
    const patches = run.overrides.patches;
    return { ...item, raw_instruction: run.objective, patches: Array.isArray(patches) ? patches : [] };
  });
  const headers = columns.map(headerOf);

  return { matrix, items, headers, seeds, selectedSeed, omittedRuns: runs.length - columns.length };
}
