import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';
import { dateLabel, slotKeyOf, slotRangeLabel } from '../../lib/timeline';
import { MODEL_FILTER_LABELS, MODEL_FILTER_VALUES } from '../../lib/model-family';
import { PHASE_CHAIN, PHASE_EXTRA, PHASE_LABELS, type Phase } from '../../lib/phases';
import { ViewSwitch, type GalleryView } from '../components/ViewSwitch';

export interface GalleryItem extends GenerationCardData {
  tags: string[];
  created_at: string;
}

export interface GalleryFilters {
  view: GalleryView;
  bad: boolean;
  /** 続きを作った Generation を隠し、仕上げの連鎖の先端だけを出す。 */
  tip: boolean;
  ids?: string;
  tag?: string;
  rating?: string;
  bookmark?: string;
  published?: string;
  reference?: string;
  /** カンマ区切り (model_family の OR)。 */
  model?: string;
  /** カンマ区切り (フェーズの OR)。 */
  phase?: string;
}

/** Every currently-active query param (view/bad included), used as the base for the view/bad/load-more links. */
function activeParams(filters: GalleryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view !== 'all') params.set('view', filters.view);
  if (filters.bad) params.set('bad', '1');
  if (filters.tip) params.set('tip', '1');
  if (filters.ids) params.set('ids', filters.ids);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.bookmark) params.set('bookmark', filters.bookmark);
  if (filters.published) params.set('published', filters.published);
  if (filters.reference) params.set('reference', filters.reference);
  if (filters.model) params.set('model', filters.model);
  if (filters.phase) params.set('phase', filters.phase);
  return params;
}

/** Gallery live insertion (docs/ui.md「Gallery」) is active only when no ids / panel filter narrows the grid — `view`/`bad`/`tip` don't disqualify it. */
function galleryLiveEligible(filters: GalleryFilters): boolean {
  return !filters.ids && !filters.tag && !filters.rating && !filters.bookmark && !filters.published && !filters.reference && !filters.model && !filters.phase;
}

function selectedValues(csv: string | undefined): string[] {
  return csv ? csv.split(',') : [];
}

function toggleHref(filters: GalleryFilters, key: 'bad' | 'tip'): string {
  const params = activeParams(filters);
  if (filters[key]) params.delete(key);
  else params.set(key, '1');
  const query = params.toString();
  return query ? `/gallery?${query}` : '/gallery';
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="6" cy="4" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
      <circle cx="11" cy="8" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
      <circle cx="5" cy="12" r="1.6" fill="var(--bg-elevated)" stroke="currentColor" stroke-width="1.2" />
    </svg>
  );
}

/** `phase` から `phase` を 1 つ足し引きしたギャラリーの URL。ほかの絞り込みと view / bad は保つ。 */
function phaseToggleHref(filters: GalleryFilters, phase: Phase | null): string {
  const params = activeParams(filters);
  const selected = selectedValues(filters.phase);
  const next = phase === null ? [] : selected.includes(phase) ? selected.filter((p) => p !== phase) : [...selected, phase];
  if (next.length > 0) params.set('phase', next.join(','));
  else params.delete('phase');
  const query = params.toString();
  return query ? `/gallery?${query}` : '/gallery';
}

function PhaseButton({ filters, phase }: { filters: GalleryFilters; phase: Phase }) {
  const on = selectedValues(filters.phase).includes(phase);
  return (
    <a class="phase-chip" href={phaseToggleHref(filters, phase)} aria-pressed={on ? 'true' : 'false'} data-phase={phase}>
      {PHASE_LABELS[phase]}
    </a>
  );
}

/** フェーズの複数選択（OR）。押すたびにその値を `phase` に足し引きする。 */
function PhaseBar({ filters }: { filters: GalleryFilters }) {
  return (
    <nav class="phase-bar" aria-label="フェーズ">
      <ol class="phase-chain">
        {PHASE_CHAIN.map((phase, i) => (
          <li>
            {i > 0 ? (
              <span class="phase-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            <PhaseButton filters={filters} phase={phase} />
          </li>
        ))}
      </ol>
      <div class="phase-extra">
        {PHASE_EXTRA.map((phase) => (
          <PhaseButton filters={filters} phase={phase} />
        ))}
      </div>
      {filters.phase ? (
        <a class="phase-clear" href={phaseToggleHref(filters, null)}>
          解除
        </a>
      ) : null}
    </nav>
  );
}

function GalleryToolbar({ filters }: { filters: GalleryFilters }) {
  const hasActiveFilter = Boolean(filters.ids || filters.tag || filters.rating || filters.bookmark || filters.published || filters.reference || filters.model);
  return (
    <div class="gallery-toolbar">
      <ViewSwitch basePath="/gallery" current={filters.view} params={activeParams(filters)} />
      <a class="bad-toggle" href={toggleHref(filters, 'bad')} aria-pressed={filters.bad ? 'true' : 'false'}>
        <span class="bad-toggle-box" aria-hidden="true"></span>
        bad も表示
      </a>
      <a class="bad-toggle" href={toggleHref(filters, 'tip')} aria-pressed={filters.tip ? 'true' : 'false'} data-tip-toggle>
        <span class="bad-toggle-box" aria-hidden="true"></span>
        途中を隠す
      </a>
      <details class="filter-panel" open={hasActiveFilter}>
        <summary>
          <FilterIcon />
          絞り込み
        </summary>
        <form class="filter-form" method="get" action="/gallery">
          <input type="hidden" name="view" value={filters.view} />
          {filters.bad ? <input type="hidden" name="bad" value="1" /> : null}
          {filters.tip ? <input type="hidden" name="tip" value="1" /> : null}
          {filters.phase ? <input type="hidden" name="phase" value={filters.phase} /> : null}
          <label>
            ID（複数可）
            <textarea name="ids" rows={1}>
              {filters.ids ?? ''}
            </textarea>
          </label>
          <label>
            tag
            <input type="text" name="tag" value={filters.tag ?? ''} placeholder="tag" />
          </label>
          <label>
            rating
            <select name="rating">
              <option value="">すべて</option>
              {(['good', 'neutral', 'bad'] as const).map((r) => (
                <option value={r} selected={filters.rating === r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="bookmark" value="true" checked={filters.bookmark === 'true'} />
            ブックマークのみ
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="published" value="true" checked={filters.published === 'true'} />
            公開済みのみ
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="reference" value="true" checked={filters.reference === 'true'} />
            基準のみ
          </label>
          <fieldset class="checkbox-group">
            <legend>モデル系統</legend>
            {MODEL_FILTER_VALUES.map((m) => (
              <label class="checkbox-field">
                <input type="checkbox" name="model" value={m} checked={selectedValues(filters.model).includes(m)} />
                {MODEL_FILTER_LABELS[m]}
              </label>
            ))}
          </fieldset>
          <button type="submit">検索</button>
        </form>
      </details>
      <PhaseBar filters={filters} />
    </div>
  );
}

function LoadMoreLink({ cursor, filters }: { cursor: string; filters: GalleryFilters }) {
  const params = activeParams(filters);
  params.set('cursor', cursor);
  return (
    <a class="load-more" href={`/gallery?${params.toString()}`}>
      もっと見る
    </a>
  );
}

function LoadNewerLink({ cursor, filters }: { cursor: string; filters: GalleryFilters }) {
  const params = activeParams(filters);
  params.set('after', cursor);
  return (
    <a class="load-newer" href={`/gallery?${params.toString()}`}>
      新しい方を読み込む
    </a>
  );
}

/** 日付・枠の見出し。枚数はクライアントが timeline から埋める (`data-count-slot` / `data-count-date`)。 */
function DateHeader({ date }: { date: string }) {
  return (
    <div class="gallery-date-header" data-date-header={date}>
      {dateLabel(date)}
      <small data-count-date={date}></small>
    </div>
  );
}

function SlotHeader({ slot }: { slot: string }) {
  return (
    <div class="gallery-slot-header" data-slot-header={slot}>
      <b>{slotRangeLabel(slot)}</b>
      <span data-count-slot={slot}></span>
    </div>
  );
}

/** Card grid content, shared by the full page render and the `partial=1` infinite-scroll fragment.
 * 日付 / 15 分枠が変わるカードの直前に見出しを挟む。フラグメントの先頭カードにも必ず付け、直前と重なる見出しはクライアントが外す。 */
export function GalleryCards({
  items,
  nextCursor,
  newerCursor = null,
  filters,
}: {
  items: GalleryItem[];
  nextCursor: string | null;
  newerCursor?: string | null;
  filters: GalleryFilters;
}) {
  let lastSlot: string | null = null;
  let lastDate: string | null = null;
  return (
    <>
      {newerCursor ? <LoadNewerLink cursor={newerCursor} filters={filters} /> : null}
      {items.map((g) => {
        const slot = slotKeyOf(g.created_at);
        const date = slot ? slot.slice(0, 10) : null;
        const showDate = date !== null && date !== lastDate;
        const showSlot = slot !== null && slot !== lastSlot;
        lastDate = date;
        lastSlot = slot;
        return (
          <>
            {showDate && date ? <DateHeader date={date} /> : null}
            {showSlot && slot ? <SlotHeader slot={slot} /> : null}
            <GenerationCard g={g} timeline />
          </>
        );
      })}
      {nextCursor ? <LoadMoreLink cursor={nextCursor} filters={filters} /> : null}
    </>
  );
}

/** 枠範囲フラグメント (`slot_from` / `slot_to`): 見出しもリンクも付けず、カードだけを返す。 */
export function GallerySlotCards({ items }: { items: GalleryItem[] }) {
  return (
    <>
      {items.map((g) => (
        <GenerationCard g={g} timeline />
      ))}
    </>
  );
}

/** `<script type="application/json">` に埋めるための JSON (`</script>` を作れる `<` を潰す)。 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function GalleryPage({
  path,
  items,
  nextCursor,
  newerCursor = null,
  filters,
  timelineQuery,
  timeline,
  at,
}: {
  path: string;
  items: GalleryItem[];
  nextCursor: string | null;
  newerCursor?: string | null;
  filters: GalleryFilters;
  /** 絞り込み済みの `GET /api/v1/generations/timeline` の query。無ければタイムラインを出さない。 */
  timelineQuery?: string;
  /** 同じ絞り込みの枠ごとの枚数。クライアントはこれで全件分のスケルトンを先に並べる。 */
  timeline?: { slots: { slot: string; count: number }[] };
  /** `at=<枠キー>` で途中から始めたときの枠キー。 */
  at?: string;
}) {
  return (
    <Layout title="ギャラリー" path={path}>
      <h1>ギャラリー</h1>
      <GalleryToolbar filters={filters} />

      <datalist id="tag-suggestions"></datalist>

      {items.length === 0 ? (
        <p class="empty-state">該当する Generation がありません</p>
      ) : (
        <>
          {timeline ? (
            <script type="application/json" id="gallery-timeline-data" dangerouslySetInnerHTML={{ __html: inlineJson(timeline) }} />
          ) : null}
          <div
            class="grid grid-gallery"
            data-gallery-grid
            data-hide-bad={!filters.bad && !filters.ids ? 'true' : undefined}
            data-gallery-view={filters.view}
            data-gallery-tip={filters.tip ? 'true' : undefined}
            data-gallery-live={galleryLiveEligible(filters) ? 'true' : undefined}
            data-timeline-query={timelineQuery}
            data-gallery-at={at}
          >
            <GalleryCards items={items} nextCursor={nextCursor} newerCursor={newerCursor} filters={filters} />
          </div>
        </>
      )}
    </Layout>
  );
}
