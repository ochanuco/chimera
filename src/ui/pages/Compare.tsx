import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import type { Child } from 'hono/jsx';
import { consensusSegments, matchMask, tokenize, twoWayDiff, type DiffSeg } from '../diff';
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

/** A Compare column: same fields Gallery/Bookmarks/Batch Detail cards use (renders as `<GenerationCard>`), plus the diff table's own fields. */
export interface CompareItem extends GenerationCardData {
  batch_short_id: string | null;
  seed: number | null;
  created_at: string;
  /** The Generation's Batch `raw_instruction` / `patches_json` (inherited patches included), for the 変更点 rows. */
  raw_instruction: string | null;
  patches: unknown[];
  semantic: CompareSemantic | null;
  render_facts: RenderFacts | null;
}

interface CompareRow {
  label: string;
  values: string[];
  diff: boolean;
  /** Per-column diff segments vs. the row's other real-value lanes (no base column): undefined for basic rows;
   * null for a cell rendered plain (no value / only one real value in the row / nothing differs). */
  segments?: (DiffSeg[] | null)[];
  /** 変更点 rows: custom cell content, never hidden as identical. */
  cells?: Child[];
  change?: boolean;
}

/** A row's per-item raw value ahead of diffing: null means "no value to diff" (not analyzed, or value itself absent). */
type SemanticCell = { display: string; raw: string | string[] | null; kind: 'text' | 'list' };

/** Renders an array field ("strengths"/"defects"/list-shaped attributes) as a comma-joined string, or null if empty. */
function joinList(values: string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join(', ');
}

/** One list item as text: object items (e.g. a `patches` entry) as JSON, since String() would yield "[object Object]". */
function itemText(item: unknown): string {
  return item !== null && typeof item === 'object' ? JSON.stringify(item) : String(item);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Sorted union of subkeys when an attribute is an object in some columns and absent in the rest, so it can be split into `key.subkey` rows;
 * null when no column holds an object or any column holds a non-object value (scalar/array), which keeps the single unflattened row. */
function flattenSubkeys(values: unknown[]): string[] | null {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length === 0 || !present.every(isPlainObject)) return null;
  return Array.from(new Set(present.flatMap((v) => Object.keys(v)))).sort();
}

/** Normalizes an arbitrary attribute value to a display string, or null if it carries no value. */
function attributeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return joinList(value.map(itemText));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type SemanticRaw = { kind: 'text'; raw: string } | { kind: 'list'; raw: string[] } | null;

/** Normalizes an arbitrary attribute value to a diffable raw value: a list for arrays, text otherwise. */
function attributeRaw(value: unknown): SemanticRaw {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const list = value.map(itemText);
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

/** Consensus segments for one lane: counts how many other real-value lanes share each token (pairwise LCS),
 * then buckets into same/partial/uniq. Null when every token matches every other lane. */
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

/** Core cells -> CompareRow builder shared by every diffable row: row's "all differ" flag, plus per-cell consensus
 * segments (no base column) — shared-by-all renders plain, shared-by-some 'partial', unique 'uniq'; no cell ever shows another cell's text. */
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

/** Builds one `render.<column>` row from each item's pre-summarized render_facts: "(no graph)" when the ComfyJob
 * carries no graph, NO_VALUE when the graph doesn't populate this column. Null (row omitted) when every item lacks a value. */
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

/** One item's pass-`passIndex` prompt text (positive/negative), "(no graph)" without a Job graph, `—` without that many passes. */
function promptCell(item: CompareItem, passIndex: number, polarity: 'positive' | 'negative'): SemanticCell {
  if (!item.render_facts) return { display: NO_GRAPH, raw: null, kind: 'text' };
  const text = item.render_facts.samplers[passIndex]?.prompt[polarity] ?? null;
  return text === null ? { display: NO_VALUE, raw: null, kind: 'text' } : { display: text, raw: text, kind: 'text' };
}

/** Builds a `render.positive`/`render.negative` row (`(pass N)` suffix for N>1). Null (row omitted) when every item lacks a value for that pass/polarity. */
function buildPromptRow(items: CompareItem[], passIndex: number, polarity: 'positive' | 'negative'): CompareRow | null {
  const label = passIndex === 0 ? `render.${polarity}` : `render.${polarity} (pass ${passIndex + 1})`;
  const cells = items.map((item) => promptCell(item, passIndex, polarity));
  if (cells.every((c) => c.raw === null)) return null;
  return buildDiffRow(label, cells);
}

/** Builds a row from generation-level facts, available regardless of semantic analysis. */
function buildBasicRow(label: string, items: CompareItem[], extract: (item: CompareItem) => string | null): CompareRow {
  const values = items.map((item) => extract(item) ?? NO_VALUE);
  const diff = new Set(values).size > 1;
  return { label, values, diff };
}

/** Key-order-independent JSON, so two patches carrying the same fields compare equal. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Drops the `prompt.positive.` prefix (kept positive-implicit) and shortens `prompt.negative.` to `negative.`, so a part reads as e.g. `artist` / `negative.quality`. */
function shortPatchTarget(target: string): string {
  if (target === 'prompt.positive') return 'positive';
  if (target === 'prompt.negative') return 'negative';
  if (target.startsWith('prompt.positive.')) return target.slice('prompt.positive.'.length);
  if (target.startsWith('prompt.negative.')) return `negative.${target.slice('prompt.negative.'.length)}`;
  return target;
}

function PatchView({ patch }: { patch: unknown }) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return <div class="cmp-patch">{itemText(patch)}</div>;
  }
  const p = patch as Record<string, unknown>;
  const part = typeof p.target === 'string' ? shortPatchTarget(p.target) : '?';
  const op = typeof p.op === 'string' ? p.op : '?';
  const hasText = (v: unknown) => typeof v === 'string';
  const isTextReplace = op === 'replace' && (hasText(p.value) || hasText(p.old));
  let body: Child;
  if (isTextReplace) {
    const segs = twoWayDiff(typeof p.old === 'string' ? p.old : '', typeof p.value === 'string' ? p.value : '');
    body = segs.map((seg) =>
      seg.type === 'same' ? seg.text : <span class={seg.type === 'del' ? 'tok-del' : 'tok-add'}>{seg.text}</span>,
    );
  } else {
    body = p.value === undefined ? op : `${op} ${itemText(p.value)}`;
  }
  return (
    <div class="cmp-patch">
      <span class="cmp-patch-part">{part}</span>: {body}
      {typeof p.reason === 'string' && p.reason ? <span class="cmp-patch-reason"> {p.reason}</span> : null}
    </div>
  );
}

/** Patches not carried by every column, per column: patches shared by all columns are inherited from the common ancestor and omitted. */
function uniquePatches(items: CompareItem[]): unknown[][] {
  const keyed = items.map((item) => {
    const seen = new Map<string, unknown>();
    for (const patch of item.patches) seen.set(stableStringify(patch), patch);
    return seen;
  });
  return keyed.map((own) => Array.from(own).filter(([key]) => !keyed.every((other) => other.has(key))).map(([, patch]) => patch));
}

function buildChangeRows(items: CompareItem[]): CompareRow[] {
  const rows: CompareRow[] = [];
  if (items.some((item) => item.raw_instruction)) {
    const values = items.map((item) => item.raw_instruction || NO_VALUE);
    rows.push({ label: 'instruction', values, diff: false, change: true, cells: values });
  }
  const unique = uniquePatches(items);
  if (unique.some((patches) => patches.length > 0)) {
    const cells = unique.map((patches) =>
      patches.length === 0 ? '（変更なし）' : patches.map((patch) => <PatchView patch={patch} />),
    );
    rows.push({ label: 'patches', values: unique.map(() => ''), diff: false, change: true, cells });
  }
  return rows;
}

const SAME_VALUE_MAX = 60;

/** A 全列同一 bar entry `label=value`: whitespace collapsed, long values cut with the full text in `title`. */
function sameChip(label: string, value: string): { text: string; title?: string } {
  const flat = value.replace(/\s+/g, ' ').trim();
  const long = flat.length > SAME_VALUE_MAX;
  return { text: `${label}=${long ? `${flat.slice(0, SAME_VALUE_MAX)}…` : flat}`, title: long ? flat : undefined };
}

const CORE_FIELDS = ['pose', 'expression', 'outfit', 'style', 'composition'] as const;

function CompareTable({ items, rows }: { items: CompareItem[]; rows: CompareRow[] }) {
  return (
    <table class="compare-table">
      <thead>
        <tr>
          <th></th>
          {items.map((item) => (
            <th>
              <a class="thumb-link compare-head-link" href={`/g/${item.short_id}`}>
                {item.short_id}
                <img class="thumb-fg" src={item.thumbnail_url} alt="" hidden loading="lazy" />
              </a>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr class={row.change ? 'compare-change' : !row.diff && !row.cells ? 'compare-same' : undefined}>
            <td>{row.label}</td>
            {row.values.map((v, i) => {
              if (row.cells) return <td>{row.cells[i]}</td>;
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
  );
}

export function ComparePage({
  path,
  items,
  missingIds,
  warning,
}: {
  path: string;
  items: CompareItem[];
  missingIds: string[];
  warning?: string;
}) {
  const changeRows: CompareRow[] = [];
  const rows: CompareRow[] = [];
  const promptRows: CompareRow[] = [];
  if (items.length >= 2) {
    changeRows.push(...buildChangeRows(items));
    rows.push(buildBasicRow('batch', items, (i) => i.batch_short_id));
    rows.push(buildBasicRow('seed', items, (i) => (i.seed != null ? String(i.seed) : null)));
    rows.push(buildBasicRow('created', items, (i) => i.created_at.slice(0, 10)));

    const renderFactSummaries = items.map((item) => (item.render_facts ? summarizeRenderFacts(item.render_facts) : null));
    for (const column of RENDER_FACT_COLUMNS) {
      const row = buildRenderFactRow(column, renderFactSummaries);
      if (row) rows.push(row);
    }

    const maxPasses = Math.max(0, ...items.map((item) => item.render_facts?.samplers.length ?? 0));
    for (let passIndex = 0; passIndex < maxPasses; passIndex++) {
      for (const polarity of ['positive', 'negative'] as const) {
        const row = buildPromptRow(items, passIndex, polarity);
        if (row) promptRows.push(row);
      }
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
    // The `patches` attribute duplicates the 変更点 patches row.
    attributeKeys.delete('patches');
    const analyzedItems = items.filter((item) => item.semantic);
    for (const key of Array.from(attributeKeys).sort()) {
      const values = analyzedItems.map((item) => item.semantic!.attributes[key]);
      const subkeys = flattenSubkeys(values);
      const targets = subkeys
        ? subkeys.map((sub) => ({ label: `${key}.${sub}`, pick: (v: unknown) => (isPlainObject(v) ? v[sub] : undefined) }))
        : [{ label: key, pick: (v: unknown) => v }];
      for (const { label, pick } of targets) {
        if (values.every((v) => attributeText(pick(v)) === null)) continue;
        rows.push(buildSemanticRow(label, items, (s) => attributeRaw(pick(s.attributes[key]))));
      }
    }
  }

  const showLegend = rows.concat(promptRows).some((row) => row.segments !== undefined);
  const sameRows = rows.filter((row) => !row.diff);
  const isEmptyValue = (v: string) => v === NO_VALUE || v === NOT_ANALYZED || v === NO_GRAPH;
  const sameChips = sameRows.filter((row) => !isEmptyValue(row.values[0]!)).map((row) => sameChip(row.label, row.values[0]!));
  const sameEmptyLabels = sameRows.filter((row) => isEmptyValue(row.values[0]!)).map((row) => row.label);
  const mainRows = changeRows.concat(rows);

  return (
    <Layout title="Compare" path={path}>
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
              <GenerationCard g={item} />
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

          {sameRows.length > 0 ? (
            <div class="compare-same-bar">
              <span class="compare-same-items">
                <span>全列同一:</span>
                {sameChips.map((chip) => (
                  <span class="compare-same-chip" title={chip.title}>
                    {chip.text}
                  </span>
                ))}
                {sameEmptyLabels.length > 0 ? <span class="compare-same-empty">値なし: {sameEmptyLabels.join(', ')}</span> : null}
              </span>
              <label>
                <input type="checkbox" id="compare-show-same" /> 同一の行も表示
              </label>
            </div>
          ) : null}

          <div class="compare-table-wrap" id="compare-main-wrap">
            <CompareTable items={items} rows={mainRows} />
          </div>

          {promptRows.length > 0 ? (
            <details class="compare-prompts">
              <summary>プロンプト全文（差分）を表示</summary>
              <div class="compare-table-wrap">
                <CompareTable items={items} rows={promptRows} />
              </div>
            </details>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
