import { REQUEST_KIND_LABELS } from './OptionControls';

export interface RequestStatusLine {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  created_at?: string;
  resultShortId?: string | null;
  error?: string | null;
  /** worker が done の `result` に書く解決済みの値 (docs/worker-protocol.md「deliver profile」)。opaque — chimera は表示するだけ。 */
  resolvedOptions?: Record<string, unknown> | null;
}

/** `Requests` section: this Generation's latest requests (all kinds). The submit script appends new rows to this list. */
export function RequestSection({
  requests,
  canPromoteToProfile,
  shortId,
}: {
  requests: RequestStatusLine[];
  canPromoteToProfile: boolean;
  shortId: string;
}) {
  return (
    <details class="section" open>
      <summary>Requests</summary>
      <div class="section-body">
        {canPromoteToProfile ? (
          <form class="promote-profile-form" data-generation-id={shortId} autocomplete="off">
            <input type="text" name="name" placeholder="profile 名" required />
            <button type="submit">profile に登録</button>
            <span class="promote-profile-status"></span>
          </form>
        ) : null}
        <ul class="request-status-list">
          {requests.map((r) => (
            <li class={`request-status-${r.status}`} data-request-id={r.id} data-request-status={r.status}>
              <span class="request-kind">{REQUEST_KIND_LABELS[r.kind] ?? r.kind}</span> {r.status} <span class="request-progress"></span>
              {r.created_at ? ` · ${r.created_at}` : null}
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
      </div>
    </details>
  );
}
