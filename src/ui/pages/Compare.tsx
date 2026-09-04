import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';
import { consensusSegments, matchMask, tokenize, type DiffSeg } from '../diff';
import { RENDER_FACT_COLUMNS, summarizeRenderFacts, type RenderFactColumn, type RenderFacts } from '../../lib/render-facts';

const NOT_ANALYZED = '(not analyzed)';
const NO_GRAPH = '(no graph)';
const NO_VALUE = '—';

export interface CompareSemantic {
  summary: string | null;
  core: {
    pose: string | null;
    expression: string | null;
    outfit: string | null;
    style: string | null;
    composition: string | null;
  };
  strengths: string[];
  defects: string[];
  attributes: Record<string, unknown>;
}

export interface CompareItem {
  short_id: string;
  image_url: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  character_name: string | null;
  batch_short_id: string | null;
  seed: number | null;
  created_at: string;
  semantic: CompareSemantic | null;
  render_facts: RenderFacts | null;
}

interface CompareRow {
  label: string;
  values: string[];
  diff: boolean;
  /**
   * Per-column diff segments, each lane highlighting only its own text against the consensus of
   * every other real-value lane in the row (no base column): undefined for basic rows; null for a
   * cell rendered plain (no value, only one real value in the row, or nothing differs from every
   * other lane). A cell never shows another cell's text.
   */
  segments?: (DiffSeg[] | null)[];
}

/** A row's per-item raw value ahead of diffing: null means "no value to diff" (not analyzed, or value itself absent). */
type SemanticCell = { display: string; raw: string | string[] | null; kind: 'text' | 'list' };

/** Renders an array field ("strengths"/"defects"/list-shaped attributes) as a comma-joined string, or null if empty. */
function joinList(values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join(', ');
}

/** Normalizes an arbitrary attribute value to a display string, or null if it carries no value. */
function attributeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return joinList(value.map(String));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type SemanticRaw = { kind: 'text'; raw: string } | { kind: 'list'; raw: string[] } | null;

/** Normalizes an arbitrary attribute value to a diffable raw value: a list for arrays, text otherwise. */
function attributeRaw(value: unknown): SemanticRaw {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const list = value.map(String);
    return list.length === 0 ? null : { kind: 'list', raw: list };
  }
  if (typeof value === 'object') return { kind: 'text', raw: JSON.stringify(value) };
  return { kind: 'text', raw: String(value) };
}

/** Wraps a plain text extractor as a diffable raw value ("no value" when null). */
function textRaw(value: string | null): SemanticRaw {
  return value === null ? null : { kind: 'text', raw: value };
}

/** Wraps a list extractor as a diffable raw value ("no value" when absent or empty). */
function listRaw(values: string[] | undefined): SemanticRaw {
  return !values || values.length === 0 ? null : { kind: 'list', raw: values };
}

/** Appends a line-separator marker to every item, so list items merged into one segment by adjacent same-type runs still land one per line. */
function withLineSep(items: string[]): string[] {
  return items.map((it) => `${it}\n`);
}

/** Strips the trailing line-separator marker left by withLineSep on the last segment. */
function stripTrailingNewline(segs: DiffSeg[]): DiffSeg[] {
  if (segs.length === 0) return segs;
  const last = segs[segs.length - 1]!;
  if (!last.text.endsWith('\n')) return segs;
  return [...segs.slice(0, -1), { ...last, text: last.text.slice(0, -1) }];
}

/**
 * Consensus segments for one lane: for each of its tokens, counts how many of the row's other
 * real-value lanes also have it (via pairwise LCS matching), then buckets into same/partial/uniq.
 * Null when every token matches every other lane (nothing lane-specific to highlight).
 */
function computeConsensusSegments(cellItems: string[], otherItemsList: string[][], isList: boolean): DiffSeg[] | null {
  if (otherItemsList.length === 0) return null;
  const tokens = isList ? withLineSep(cellItems) : cellItems;
  const otherTokensList = otherItemsList.map((other) => (isList ? withLineSep(other) : other));
  const matchCounts = tokens.map(() => 0);
  for (const otherTokens of otherTokensList) {
    const mask = matchMask(tokens, otherTokens);
    for (let i = 0; i < matchCounts.length; i++) matchCounts[i] = matchCounts[i]! + (mask[i]! ? 1 : 0);
  }
  const segs = consensusSegments(tokens, matchCounts, otherTokensList.length);
  if (segs.every((s) => s.type === 'same')) return null;
  return isList ? stripTrailingNewline(segs) : segs;
}

/**
 * Core cells -> CompareRow builder shared by every diffable row: the "all differ" row-level
 * flag, plus per-cell consensus segments. Every cell with a real value is diffed against the
 * consensus of all other real-value cells in the row (no base column): a token shared with
 * every other lane renders plain, one shared with some renders 'partial', one unique to this
 * lane renders 'uniq' — no cell ever renders another cell's text.
 */
function buildDiffRow(label: string, cells: SemanticCell[]): CompareRow {
  const values = cells.map((c) => c.display);
  const diff = new Set(values).size > 1;

  const realIndexes = cells.reduce<number[]>((acc, c, i) => (c.raw !== null ? [...acc, i] : acc), []);
  // Mixed text/list kinds in the same row (e.g. an attribute that's a scalar for one generation
  // and an array for another) fall back to item-granularity diffing for the whole row.
  const isListRow = realIndexes.some((i) => cells[i]!.kind === 'list');
  const toItems = (cell: SemanticCell): string[] => {
    if (isListRow) return cell.kind === 'list' ? (cell.raw as string[]) : [cell.raw as string];
    return tokenize(cell.raw as string);
  };

  const segments: (DiffSeg[] | null)[] = cells.map((cell, i) => {
    if (cell.raw === null || realIndexes.length <= 1) return null;
    const others = realIndexes.filter((idx) => idx !== i).map((idx) => toItems(cells[idx]!));
    return computeConsensusSegments(toItems(cell), others, isListRow);
  });

  return { label, values, diff, segments };
}

/** Builds one semantic comparison row: "(not analyzed)" for an un-analyzed item, else extractRaw's value. */
function buildSemanticRow(label: string, items: CompareItem[], extractRaw: (s: CompareSemantic) => SemanticRaw): CompareRow {
  const cells: SemanticCell[] = items.map((item) => {
    if (!item.semantic) return { display: NOT_ANALYZED, raw: null, kind: 'text' };
    const r = extractRaw(item.semantic);
    if (r === null) return { display: NO_VALUE, raw: null, kind: 'text' };
    if (r.kind === 'list') return { display: joinList(r.raw) ?? NO_VALUE, raw: r.raw, kind: 'list' };
    return { display: r.raw, raw: r.raw, kind: 'text' };
  });
  return buildDiffRow(label, cells);
}

/**
 * Builds one `render.<column>` row from each item's pre-summarized render_facts: "(no graph)"
 * when the Generation's ComfyJob carries no graph, NO_VALUE when the graph doesn't populate this
 * column. Returns null (row omitted entirely) when every item has no value for this column.
 */
function buildRenderFactRow(
  column: RenderFactColumn,
  summaries: (Record<RenderFactColumn, string | null> | null)[],
): CompareRow | null {
  const cells: SemanticCell[] = summaries.map((summary) => {
    if (!summary) return { display: NO_GRAPH, raw: null, kind: 'text' };
    const value = summary[column];
    return value === null ? { display: NO_VALUE, raw: null, kind: 'text' } : { display: value, raw: value, kind: 'text' };
  });
  if (cells.every((c) => c.raw === null)) return null;
  return buildDiffRow(`render.${column}`, cells);
}

/** Builds a row from generation-level facts, available regardless of semantic analysis. */
function buildBasicRow(label: string, items: CompareItem[], extract: (item: CompareItem) => string | null): CompareRow {
  const values = items.map((item) => extract(item) ?? NO_VALUE);
  const diff = new Set(values).size > 1;
  return { label, values, diff };
}

const CORE_FIELDS = ['pose', 'expression', 'outfit', 'style', 'composition'] as const;

export function ComparePage({ items, missingIds, warning }: { items: CompareItem[]; missingIds: string[]; warning?: string }) {
  const rows: CompareRow[] = [];
  if (items.length >= 2) {
    rows.push(buildBasicRow('batch', items, (i) => i.batch_short_id));
    rows.push(buildBasicRow('seed', items, (i) => (i.seed != null ? String(i.seed) : null)));
    rows.push(buildBasicRow('created', items, (i) => i.created_at.slice(0, 10)));

    const renderFactSummaries = items.map((item) => (item.render_facts ? summarizeRenderFacts(item.render_facts) : null));
    for (const column of RENDER_FACT_COLUMNS) {
      const row = buildRenderFactRow(column, renderFactSummaries);
      if (row) rows.push(row);
    }

    rows.push(buildSemanticRow('summary', items, (s) => textRaw(s.summary)));
    for (const field of CORE_FIELDS) {
      rows.push(buildSemanticRow(field, items, (s) => textRaw(s.core[field])));
    }
    rows.push(buildSemanticRow('strengths', items, (s) => listRaw(s.strengths)));
    rows.push(buildSemanticRow('defects', items, (s) => listRaw(s.defects)));

    const attributeKeys = new Set<string>();
    for (const item of items) {
      if (item.semantic) {
        for (const key of Object.keys(item.semantic.attributes)) attributeKeys.add(key);
      }
    }
    for (const key of Array.from(attributeKeys).sort()) {
      const analyzedItems = items.filter((item) => item.semantic);
      const allValueLess = analyzedItems.every((item) => attributeText(item.semantic!.attributes[key]) === null);
      if (allValueLess) continue;
      rows.push(buildSemanticRow(key, items, (s) => attributeRaw(s.attributes[key])));
    }
  }

  const showLegend = rows.some((row) => row.segments !== undefined);

  return (
    <Layout title="Compare">
      <h1>Compare</h1>
      {warning ? <p class="empty-state">{warning}</p> : null}
      {missingIds.length > 0 ? <p class="empty-state">Not found: {missingIds.join(', ')}</p> : null}

      {items.length < 2 ? (
        <p class="empty-state">Select 2–9 generations from the Gallery to compare.</p>
      ) : (
        <div id="compare-page">
          <div class="compare-cols-picker">
            <label for="compare-cols">Columns:</label>
            <select id="compare-cols">
              <option value="auto">Auto</option>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option value={String(n)}>{n}</option>
              ))}
            </select>
          </div>
          <div class="compare-columns">
            {items.map((item) => (
              <div class="compare-col">
                <a class="thumb-link" href={`/g/${item.short_id}`}>
                  <img class="thumb-fg" src={item.image_url} alt={item.short_id} />
                </a>
                <a class="short-id-link" href={`/g/${item.short_id}`}>
                  {item.short_id}
                </a>
                <CopyIdButton value={item.short_id} />
                <div class="compare-meta">{item.rating ?? NO_VALUE}</div>
                <div class="compare-meta">{item.character_name ?? NO_VALUE}</div>
              </div>
            ))}
          </div>

          {items.some((item) => !item.semantic) ? (
            <p class="empty-state">
              Some generations are not semantically analyzed yet — their semantic rows show "(not analyzed)". Run
              semantic analysis (UC-11) to compare them.
            </p>
          ) : null}

          {showLegend ? (
            <p class="compare-legend">
              全ての列に共通の部分はそのまま、一部の列とだけ一致する部分を<span class="tok-partial">黄</span>、その列にしかない部分を
              <span class="tok-uniq">緑</span>で表示します。
            </p>
          ) : null}

          <div class="compare-table-wrap">
            <table class="compare-table">
              <thead>
                <tr>
                  <th></th>
                  {items.map((item) => (
                    <th>{item.short_id}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td>{row.label}</td>
                    {row.values.map((v, i) => {
                      const segs = row.segments?.[i] ?? null;
                      return (
                        <td class={row.diff ? 'diff' : undefined}>
                          {segs
                            ? segs.map((seg) =>
                                seg.type === 'same' ? (
                                  seg.text
                                ) : (
                                  <span class={seg.type === 'uniq' ? 'tok-uniq' : 'tok-partial'}>{seg.text}</span>
                                ),
                              )
                            : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
