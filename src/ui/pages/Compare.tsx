import { Layout } from '../layout';

const ASPECTS = ['pose', 'expression', 'outfit', 'style', 'composition', 'other'] as const;

export interface CompareItem {
  short_id: string;
  image_url: string;
}

export function ComparePage({ items, missingIds, warning }: { items: CompareItem[]; missingIds: string[]; warning?: string }) {
  return (
    <Layout title="Compare">
      <h1>Compare</h1>
      {warning ? <p class="empty-state">{warning}</p> : null}
      {missingIds.length > 0 ? <p class="empty-state">Not found: {missingIds.join(', ')}</p> : null}

      {items.length < 2 ? (
        <p class="empty-state">Select 2–9 generations from the Gallery to compare.</p>
      ) : (
        <div id="compare-page">
          <div class="compare-columns">
            {items.map((item) => (
              <div class="compare-col">
                <img src={item.image_url} alt={item.short_id} />
                <div class="short-id-link">{item.short_id}</div>
                <select class="aspect-select" data-short-id={item.short_id}>
                  <option value="">(not used)</option>
                  {ASPECTS.map((a) => (
                    <option value={a}>{a}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div class="instructions-box">
            <h2>Selected references</h2>
            <textarea id="instructions-output" readonly></textarea>
            <br />
            <button type="button" id="copy-instructions-btn">
              Copy
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
