import { FinalizeFields } from './FinalizeFields';

export interface FinalizeRequestStatusLine {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at?: string;
  resultShortId?: string | null;
  error?: string | null;
}

/**
 * `Finalize` section shared by Generation Detail's full page and the Lightbox panel
 * (docs/ui.md「Generation Detail」「Finalize」節). `showCreatedAt` controls whether each request
 * row includes `· created_at` (Generation Detail does, Batch Detail's summarized list doesn't).
 */
export function FinalizeSection({
  shortId,
  recipe,
  requests,
  open = true,
  showCreatedAt = true,
}: {
  shortId: string;
  recipe: string | null;
  requests: FinalizeRequestStatusLine[];
  open?: boolean;
  showCreatedAt?: boolean;
}) {
  return (
    <details class="section" open={open}>
      <summary>Finalize</summary>
      <div class="section-body">
        <form class="finalize-form" data-generation-short-id={shortId} autocomplete="off">
          <FinalizeFields recipe={recipe} submitLabel="Finalize" />
        </form>
        {requests.length > 0 ? (
          <ul class="request-status-list">
            {requests.map((r) => (
              <li class={`request-status-${r.status}`} data-request-id={r.id} data-request-status={r.status}>
                {r.status} <span class="request-progress"></span>
                {showCreatedAt && r.created_at ? ` · ${r.created_at}` : null}
                {r.status === 'done' && r.resultShortId ? (
                  <>
                    {' '}
                    — <a href={`/g/${r.resultShortId}`}>{r.resultShortId}</a>
                  </>
                ) : null}
                {r.status === 'failed' && r.error ? <> — {r.error}</> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
