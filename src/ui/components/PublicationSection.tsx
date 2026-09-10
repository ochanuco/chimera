export interface PublicationData {
  id: string;
  generation_id: string;
  url: string | null;
  published_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** `MM-DD HH:mm`（UTC）。src/ui/static.ts の formatPublishedAt と同じ書式を保つこと。 */
function formatPublishedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** src/ui/static.ts の updatePublicationStatus が同じ markup を JS 側で組み立てる。 */
export function PublishIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2L2 7.5L7 9L9 14L14 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M14 2L7 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

/**
 * `公開` section (docs/ui.md「Generation Detail」節): rating/bookmark 行の直後に置く、
 * Generation Detail のフルページと Lightbox パネル (`GET /g/:short_id?partial=lightbox`) の
 * 両方から使う共有コンポーネント。JS側の書き換え (initPublicationAdd 等, src/ui/static.ts) は
 * この markup と同じ形を組み立てる。
 */
export function PublicationSection({ generationId, publications }: { generationId: string; publications: PublicationData[] }) {
  return (
    <details class="section publication-section" open data-generation-id={generationId}>
      <summary>公開</summary>
      <div class="section-body">
        <p class={`publication-status${publications.length > 0 ? ' published' : ''}`}>
          {publications.length > 0 ? (
            <>
              <PublishIcon /> {`公開済み（${publications.length}）`}
            </>
          ) : (
            '未公開'
          )}
        </p>
        <ul class="publication-list">
          {publications.map((p) => (
            <li class="publication-row" data-publication-id={p.id}>
              <span class="publication-time">{formatPublishedAt(p.published_at)}</span>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.url}
                </a>
              ) : (
                <>
                  <span class="publication-nourl">URL なし</span>
                  <input type="text" class="publication-url-input" placeholder="投稿 URL" />
                </>
              )}
              <button type="button" class="publication-remove-btn">
                ×
              </button>
            </li>
          ))}
        </ul>
        <form class="publication-add-form">
          <input type="text" name="url" placeholder="投稿 URL（空でも記録できる）" />
          <button type="submit" class="publication-add-btn">
            公開を記録
          </button>
        </form>
      </div>
    </details>
  );
}
