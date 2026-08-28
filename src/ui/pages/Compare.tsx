import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';
import { addOnlySegments, delMask, maskToSegments, tokenize, type DiffSeg } from '../diff';

const NOT_ANALYZED = '(not analyzed)';
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
}

interface CompareRow {
  label: string;
  values: string[];
  diff: boolean;
  /**
   * Per-column diff segments, each lane highlighting only its own text (WinMerge-style, not a
   * merged word-diff): undefined for basic rows; null for a cell rendered plain (no value, only
   * one real value in the row, or nothing differs). The base cell (first real value) highlights
   * parts lost in every other column as 'del'; every other real cell highlights its own parts the
   * base lacks as 'add'. A cell never shows another cell's text.
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
 * Base-cell segments: the OR of delMask(base, other) across every other real cell in the row, so
 * the base highlights (as 'del') any of its own parts that some other column lost. Null when
 * nothing differs anywhere.
 */
function computeBaseSegments(baseItems: string[], otherItemsList: string[][], isList: boolean): DiffSeg[] | null {
  if (otherItemsList.length === 0) return null;
  const tokens = isList ? withLineSep(baseItems) : baseItems;
  const mask = tokens.map(() => false);
  for (const other of otherItemsList) {
    const otherTokens = isList ? withLineSep(other) : other;
    const m = delMask(tokens, otherTokens);
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] || m[i]!;
  }
  if (!mask.some(Boolean)) return null;
  const segs = maskToSegments(tokens, mask);
  return isList ? stripTrailingNewline(segs) : segs;
}

/** Non-base cell segments: this cell's own text, with parts the base lacks highlighted as 'add'. Null when identical to base. */
function computeTargetSegments(baseItems: string[], cellItems: string[], isList: boolean): DiffSeg[] | null {
  const baseTokens = isList ? withLineSep(baseItems) : baseItems;
  const cellTokens = isList ? withLineSep(cellItems) : cellItems;
  const segs = addOnlySegments(baseTokens, cellTokens);
  if (segs.every((s) => s.type === 'same')) return null;
  return isList ? stripTrailingNewline(segs) : segs;
}

/**
 * Builds one semantic comparison row. Each cell's raw value feeds display text (via joinList for
 * lists) and the "all differ" row-level diff flag. Beyond that, each cell is diffed independently
 * against the row's base (the first item with a real value): the base highlights parts lost in any
 * other column, every other cell highlights its own parts the base lacks — no cell ever renders
 * another cell's text.
 */
function buildSemanticRow(label: string, items: CompareItem[], extractRaw: (s: CompareSemantic) => SemanticRaw): CompareRow {
  const cells: SemanticCell[] = items.map((item) => {
    if (!item.semantic) return { display: NOT_ANALYZED, raw: null, kind: 'text' };
    const r = extractRaw(item.semantic);
    if (r === null) return { display: NO_VALUE, raw: null, kind: 'text' };
    if (r.kind === 'list') return { display: joinList(r.raw) ?? NO_VALUE, raw: r.raw, kind: 'list' };
    return { display: r.raw, raw: r.raw, kind: 'text' };
  });

  const values = cells.map((c) => c.display);
  const diff = new Set(values).size > 1;

  const baseIndex = cells.findIndex((c) => c.raw !== null);
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
    const base = cells[baseIndex]!;
    if (i === baseIndex) {
      const others = realIndexes.filter((idx) => idx !== baseIndex).map((idx) => toItems(cells[idx]!));
      return computeBaseSegments(toItems(base), others, isListRow);
    }
    return computeTargetSegments(toItems(base), toItems(cell), isListRow);
  });

  return { label, values, diff, segments };
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
              各行の最初の値を基準に、基準側で変わった部分を<span class="tok-del">赤</span>、他の列で追加・変更された部分を
              <span class="tok-add">緑</span>で表示します。
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
                                  <span class={seg.type === 'add' ? 'tok-add' : 'tok-del'}>{seg.text}</span>
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
