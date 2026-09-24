import { Layout } from '../layout';
import { GenerationCard, type GenerationCardData } from '../components/GenerationCard';

export interface StyleCheckRowRequest {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
  /** done かつ result.generation_ids[0] が解決できたときだけ埋まる。 */
  resultCard: GenerationCardData | null;
}

export interface StyleCheckRowView {
  framing: string;
  pose: string;
  /** 無ければこの行は「pin 無し」で描けない。 */
  pin: GenerationCardData | null;
  /** pin があるときだけ埋まる。今の catalog commit での plain render request、無ければ「まだ描いていない」。 */
  request: StyleCheckRowRequest | null;
}

function StyleCheckResult({ row }: { row: StyleCheckRowView }) {
  if (!row.request) return <p class="empty-state">まだ描いていない</p>;
  if (row.request.status === 'done' && row.request.resultCard) {
    return <GenerationCard g={row.request.resultCard} />;
  }
  return (
    <ul class="request-status-list">
      <li class={`request-status-${row.request.status}`} data-request-id={row.request.id} data-request-status={row.request.status}>
        {row.request.status} <span class="request-progress"></span>
        {row.request.status === 'failed' && row.request.error ? <> — {row.request.error}</> : null}
      </li>
    </ul>
  );
}

function StyleCheckRow({ row }: { row: StyleCheckRowView }) {
  const compareIds =
    row.pin && row.request?.status === 'done' && row.request.resultCard ? `${row.pin.short_id},${row.request.resultCard.short_id}` : null;
  return (
    <section class="style-check-row">
      <h2 class="style-check-row-title">
        {row.framing} <span class="style-check-row-pose">({row.pose})</span>
      </h2>
      {row.pin ? (
        <div class="style-check-pair">
          <div class="style-check-cell">
            <h3>pin</h3>
            <GenerationCard g={row.pin} />
          </div>
          <div class="style-check-cell">
            <h3>今のカタログでの plain render</h3>
            <div class="style-check-result" data-style-check-slot={row.pose}>
              <StyleCheckResult row={row} />
            </div>
          </div>
        </div>
      ) : (
        <p class="empty-state">pin 無し</p>
      )}
      {compareIds ? (
        <p>
          <a href={`/compare?ids=${compareIds}`}>pin と比較</a>
        </p>
      ) : null}
    </section>
  );
}

export function StyleCheckPage({
  path,
  recipe,
  gitCommit,
  rows,
}: {
  path: string;
  recipe: string;
  gitCommit: string | null;
  rows: StyleCheckRowView[];
}) {
  return (
    <Layout title="絵柄チェック" path={path}>
      <h1>絵柄チェック</h1>
      <p class="image-meta">
        {recipe} · 今のカタログ commit: <code>{gitCommit ?? '-'}</code>
      </p>
      <p>
        <button type="button" class="style-check-render-btn" data-style-check-render data-recipe={recipe}>
          今の既定で描く
        </button>
      </p>
      {rows.map((row) => (
        <StyleCheckRow row={row} />
      ))}
    </Layout>
  );
}
