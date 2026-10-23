import { Layout } from '../layout';
import { PHOTO_MAX_SIDE } from '../../lib/photos';
import type { ReferenceItem } from '../../lib/references';

function GenerateLink({ generate }: { generate: NonNullable<ReferenceItem['generate']> }) {
  if (generate.generation_short_ids.length > 0) {
    return (
      <span class="reference-generations">
        {generate.generation_short_ids.map((sid) => (
          <a href={`/g/${sid}`} class="reference-generation">
            <img src={`/g/${sid}/preview`} alt={sid} loading="lazy" />
            <span class="mono">{sid}</span>
          </a>
        ))}
      </span>
    );
  }
  return (
    <span class="reference-generate" data-generate-request-id={generate.id}>
      generate <span class="mono">{generate.short_id ?? generate.id}</span> {generate.status ?? ''}
    </span>
  );
}

function ReferenceRow({ item }: { item: ReferenceItem }) {
  const parts = item.applied ? Object.entries(item.applied) : [];
  return (
    <details class={`reference-item request-status-${item.status}`} data-reference-id={item.id}>
      <summary>
        <span class="mono">{item.short_id ?? item.id}</span> {item.status}
        {item.seed !== null ? <> · seed {item.seed}</> : null} · {item.created_at}
        {item.status === 'failed' && item.error ? <> — {item.error}</> : null}
        {item.generate ? (
          <>
            {' '}
            → <GenerateLink generate={item.generate} />
          </>
        ) : null}
      </summary>
      <dl class="reference-tags">
        {item.pose ? (
          <>
            <dt>pose</dt>
            <dd class="mono">{item.pose}</dd>
          </>
        ) : null}
        {parts.map(([part, tags]) => (
          <>
            <dt>{part}</dt>
            <dd>
              {tags.map((tag) => (
                <span class="reference-tag">{tag}</span>
              ))}
            </dd>
          </>
        ))}
        {item.dropped && item.dropped.length > 0 ? (
          <>
            <dt>外したタグ</dt>
            <dd>
              {item.dropped.map((tag) => (
                <span class="reference-tag reference-tag-dropped">{tag}</span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}

/** `/references`: upload a reference image to draw from (kind reference), and list the reference requests with what the worker applied. */
export function ReferencesPage({ path, items }: { path: string; items: ReferenceItem[] }) {
  return (
    <Layout title="参考画像" path={path}>
      <h1>参考画像</h1>
      <form class="photo-upload" data-reference-upload data-max-side={String(PHOTO_MAX_SIDE)}>
        <input type="file" accept="image/png,image/jpeg,image/webp" required data-reference-file />
        <input type="number" name="seed" min="0" step="1" placeholder="seed" class="reference-seed" data-reference-seed />
        <button type="submit" class="wb-pill wb-pill-on">
          描く
        </button>
        <span class="photo-upload-status" data-reference-status aria-live="polite"></span>
      </form>
      {items.length === 0 ? (
        <p class="empty-state">参考画像から描いたものはまだありません</p>
      ) : (
        <div class="reference-list">
          {items.map((item) => (
            <ReferenceRow item={item} />
          ))}
        </div>
      )}
    </Layout>
  );
}
