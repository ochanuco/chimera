import { Layout } from '../layout';
import { PHOTO_MAX_SIDE } from '../../lib/photos';
import type { ReferenceListItem } from '../../lib/references';

const STATUS_LABELS: Record<string, string> = { queued: '解析待ち', running: '解析中', done: '解析済み', failed: '失敗', cancelled: '中止' };

/** `/references`: upload a reference image to analyze (kind reference), and list the references, each linking to its tag page. */
export function ReferencesPage({ path, items }: { path: string; items: ReferenceListItem[] }) {
  return (
    <Layout title="参考画像" path={path}>
      <h1>参考画像</h1>
      <form class="photo-upload" data-reference-upload data-max-side={String(PHOTO_MAX_SIDE)}>
        <input type="file" accept="image/png,image/jpeg,image/webp" required data-reference-file />
        <button type="submit" class="wb-pill wb-pill-on">
          アップロード
        </button>
        <span class="photo-upload-status" data-reference-status aria-live="polite"></span>
        <img class="reference-preview" alt="" hidden data-reference-preview />
      </form>
      {items.length === 0 ? (
        <p class="empty-state">参考画像はまだありません</p>
      ) : (
        <ul class="reference-list">
          {items.map((item) => (
            <li class={`reference-item request-status-${item.status}`} data-reference-id={item.id}>
              <a class="mono" href={`/references/${item.short_id ?? item.id}`}>
                {item.short_id ?? item.id}
              </a>{' '}
              {STATUS_LABELS[item.status] ?? item.status} · {item.created_at}
              {item.renders > 0 ? <> · {item.renders} 回描いた</> : null}
              {item.status === 'failed' && item.error ? <> — {item.error}</> : null}
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
