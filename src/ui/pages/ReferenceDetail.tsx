import { Layout } from '../layout';
import { GenerationCard } from '../components/GenerationCard';
import type { ReferenceDetail, ReferenceRenderItem } from '../../lib/references';
import type { ReferenceCandidate } from '../../lib/reference-renders';

const STATUS_LABELS: Record<string, string> = { queued: '解析待ち', running: '解析中', failed: '解析に失敗しました', cancelled: '中止しました' };
const RENDER_STATUS_LABELS: Record<string, string> = { queued: '待機中', running: '処理中', failed: '失敗', cancelled: '中止', done: '描画中' };

function fmt(n: number | null): string {
  return n === null ? '–' : n.toFixed(2);
}

function groupByPart(candidates: ReferenceCandidate[]): [string, ReferenceCandidate[]][] {
  const parts = new Map<string, ReferenceCandidate[]>();
  for (const c of candidates) {
    const list = parts.get(c.part) ?? [];
    list.push(c);
    parts.set(c.part, list);
  }
  return Array.from(parts.entries());
}

function TagChips({ detail }: { detail: ReferenceDetail }) {
  return (
    <>
      {groupByPart(detail.candidates).map(([part, candidates]) => (
        <div class="wb-field" data-ref-part={part}>
          {part}
          <div class="wb-pills" role="group" aria-label={part}>
            {candidates.map((c) => (
              <button
                type="button"
                class={`wb-pill ref-chip${c.applied ? ' wb-pill-on' : ' ref-chip-dim'}`}
                aria-pressed={c.applied ? 'true' : 'false'}
                data-ref-tag={c.tag}
                data-ref-tag-part={part}
                title={`score ${fmt(c.score)} · d1 ${fmt(c.d1)}${c.kept ? ' · kept' : ''}`}
              >
                {c.tag}
                {c.applied ? null : (
                  <span class="ref-chip-score">
                    {' '}
                    {fmt(c.score)} / {fmt(c.d1)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function RenderCaption({ render }: { render: ReferenceRenderItem }) {
  const parts = Object.entries(render.applied);
  return (
    <span class="wb-meta ref-render-meta">
      {render.pose ?? ''} · seed {render.seed ?? 'ランダム'}
      {parts.length > 0 ? <> · {parts.map(([part, tags]) => `${part}: ${tags.join(', ')}`).join(' / ')}</> : null}
    </span>
  );
}

/** render → generate → Generation の順に、新しい順で並べる。描き終わっていない render は状態のタイルを出す。 */
export function ReferenceRenders({ renders }: { renders: ReferenceRenderItem[] }) {
  if (renders.length === 0) return <p class="wb-note">まだ描いていません</p>;
  return (
    <div class="grid ref-renders">
      {renders.flatMap((render) => {
        if (render.generations.length > 0) {
          return render.generations.map((g) => (
            <GenerationCard g={g} compact>
              <RenderCaption render={render} />
            </GenerationCard>
          ));
        }
        const failed = render.status === 'failed' ? render.error : render.generate?.status === 'failed' ? render.generate.error : null;
        const status = render.status === 'done' && render.generate?.status ? render.generate.status : render.status;
        return [
          <div class={`card card-compact ref-render-pending request-status-${status}`} data-ref-render={render.id}>
            <div class="ref-render-tile">{RENDER_STATUS_LABELS[status] ?? status}</div>
            <div class="card-extra">
              <RenderCaption render={render} />
              {failed ? <p class="wb-error">{failed}</p> : null}
            </div>
          </div>,
        ];
      })}
    </div>
  );
}

/** `/references/{short_id}`: ワークベンチの形で、解析したタグを選んで描き、描いた絵を並べる。 */
export function ReferenceDetailPage({ path, detail, pending }: { path: string; detail: ReferenceDetail; pending: boolean }) {
  const analyzed = detail.status === 'done';
  const sid = detail.short_id ?? detail.id;
  return (
    <Layout title={`参考画像 ${sid}`} fullBleed path={path}>
      <div
        class="wb ref"
        data-reference-page
        data-reference-id={detail.id}
        data-reference-short-id={sid}
        data-reference-status={detail.status}
        data-pending={pending ? 'true' : 'false'}
      >
        <div class="wb-head">
          <a class="wb-back" href="/references">
            参考画像の一覧
          </a>
          <span class="wb-meta">
            参考画像 <span class="mono">{sid}</span> · {detail.created_at}
          </span>
        </div>

        <div class="wb-main">
          <section class="wb-compare" aria-label="描いた絵">
            <figure class="wb-fig ref-preview" data-ref-preview hidden>
              <figcaption class="wb-cap">参考画像</figcaption>
              <img alt="" data-ref-preview-img />
            </figure>
            <div data-ref-renders>
              <ReferenceRenders renders={detail.renders} />
            </div>
          </section>

          <section class="wb-panel" aria-label="タグを選ぶ">
            <div class="wb-panel-body">
              <h2 class="wb-panel-title">タグを選ぶ</h2>
              {analyzed ? (
                <>
                  <TagChips detail={detail} />
                  <label class="wb-field">
                    pose
                    <select name="ref_pose" data-ref-pose>
                      {detail.poses.map((p) => (
                        <option value={p} selected={p === detail.pose}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="wb-field">
                    seed
                    <input type="number" name="ref_seed" min="0" step="1" placeholder="ランダム" data-ref-seed />
                  </label>
                </>
              ) : detail.status === 'failed' || detail.status === 'cancelled' ? (
                <p class="wb-error" role="alert">
                  {STATUS_LABELS[detail.status]}
                  {detail.error ? `: ${detail.error}` : ''}
                </p>
              ) : (
                <p class="wb-note ref-progress" aria-live="polite" data-request-id={detail.id} data-request-status={detail.status}>
                  {STATUS_LABELS[detail.status]}
                  <span class="request-progress"></span>
                </p>
              )}
            </div>
            {analyzed ? (
              <div class="wb-panel-foot">
                <p class="wb-error" data-ref-error role="alert" hidden></p>
                <button type="button" class="wb-run" data-ref-run>
                  描く
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </Layout>
  );
}
