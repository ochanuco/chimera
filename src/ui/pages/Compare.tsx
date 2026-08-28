import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';

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
}

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

/** Builds one comparison row: per-item raw values, feeding both display text and the "all value-less" check. */
function buildRow(label: string, items: CompareItem[], extract: (s: CompareSemantic) => string | null): CompareRow {
  const values = items.map((item) => (item.semantic ? (extract(item.semantic) ?? NO_VALUE) : NOT_ANALYZED));
  const diff = new Set(values).size > 1;
  return { label, values, diff };
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
    rows.push(buildRow('summary', items, (s) => s.summary));
    for (const field of CORE_FIELDS) {
      rows.push(buildRow(field, items, (s) => s.core[field]));
    }
    rows.push(buildRow('strengths', items, (s) => joinList(s.strengths)));
    rows.push(buildRow('defects', items, (s) => joinList(s.defects)));

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
      rows.push(buildRow(key, items, (s) => attributeText(s.attributes[key])));
    }
  }

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
                <a href={`/g/${item.short_id}`}>
                  <img src={item.image_url} alt={item.short_id} />
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
                    {row.values.map((v) => (
                      <td class={row.diff ? 'diff' : undefined}>{v}</td>
                    ))}
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
