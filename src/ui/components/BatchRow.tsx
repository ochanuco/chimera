export interface BatchRowData {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  status: string;
  bookmark: boolean;
  created_at: string;
  generation_count: number;
  thumbnail: { thumbnail_url: string } | null;
}

function excerpt(text: string | null, max = 90): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Row used in the Batches list. */
export function BatchRow({ b }: { b: BatchRowData }) {
  return (
    <div class="batch-row">
      <a href={`/b/${b.short_id}`}>
        {b.thumbnail ? <img src={b.thumbnail.thumbnail_url} alt={b.short_id} /> : <img alt="" />}
      </a>
      <div class="batch-meta">
        <div class="card-top-row">
          <a class="short-id-link" href={`/b/${b.short_id}`}>
            {b.short_id}
          </a>
          <button
            type="button"
            class="bookmark-btn"
            data-kind="batches"
            data-id={b.id}
            data-bookmarked={b.bookmark ? 'true' : 'false'}
            title="bookmark"
          >
            🔖
          </button>
        </div>
        <div class="instruction-excerpt">{excerpt(b.raw_instruction)}</div>
        <div>
          status: {b.status} · {b.generation_count} generations · {b.created_at}
        </div>
      </div>
    </div>
  );
}
