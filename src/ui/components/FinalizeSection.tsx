import { FinalizeFields } from './FinalizeFields';
import type { FinalizeDials, FinalizeProfileOption } from '../finalize-options';

export interface FinalizeRequestStatusLine {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at?: string;
  resultShortId?: string | null;
  error?: string | null;
  /** worker が done の `result` に書く解決済みの値 (docs/worker-protocol.md「finalize profile」)。opaque — chimera は表示するだけ。 */
  resolvedOptions?: Record<string, unknown> | null;
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
  dials = null,
  profiles = [],
  canPromoteToProfile = false,
}: {
  shortId: string;
  recipe: string | null;
  requests: FinalizeRequestStatusLine[];
  open?: boolean;
  showCreatedAt?: boolean;
  dials?: FinalizeDials | null;
  profiles?: FinalizeProfileOption[];
  canPromoteToProfile?: boolean;
}) {
  return (
    <details class="section" open={open}>
      <summary>Finalize</summary>
      <div class="section-body">
        <form class="finalize-form" data-generation-short-id={shortId} autocomplete="off" data-dials={JSON.stringify(dials ?? {})}>
          <FinalizeFields recipe={recipe} submitLabel="Finalize" dials={dials} profiles={profiles} />
        </form>
        {canPromoteToProfile ? (
          <form class="promote-profile-form" data-generation-id={shortId} autocomplete="off">
            <input type="text" name="name" placeholder="profile 名" required />
            <button type="submit">profile に登録</button>
            <span class="promote-profile-status"></span>
          </form>
        ) : null}
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
                {r.status === 'done' && r.resolvedOptions ? <> （resolved: {JSON.stringify(r.resolvedOptions)}）</> : null}
                {r.status === 'failed' && r.error ? <> — {r.error}</> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
