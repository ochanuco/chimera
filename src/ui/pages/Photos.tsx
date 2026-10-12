import { Layout } from '../layout';
import { CopyIdButton } from '../components/CopyIdButton';
import { PHOTO_MAX_SIDE, type PhotoItem } from '../../lib/photos';

/** `/photos`: upload photos to stand delivered pictures in (photo_generation), and list the uploaded ones. */
export function PhotosPage({ path, items }: { path: string; items: PhotoItem[] }) {
  return (
    <Layout title="写真" path={path}>
      <h1>写真</h1>
      <p class="photo-lead">
        納品の絵をアクスタのように立てる背景の写真です。登録した写真の ID を photo_generation の <code>photo</code> に渡します。
      </p>
      <form class="photo-upload" data-photo-upload data-max-side={String(PHOTO_MAX_SIDE)}>
        <input type="file" accept="image/*" multiple data-photo-files />
        <button type="submit" class="wb-pill wb-pill-on">
          アップロード
        </button>
        <span class="photo-upload-status" data-photo-status aria-live="polite"></span>
      </form>
      {items.length === 0 ? (
        <p class="empty-state">登録した写真はまだありません</p>
      ) : (
        <div class="work-grid photo-grid">
          {items.map((photo) => (
            <div class="work-source">
              <a href={`/g/${photo.short_id}`}>
                <img src={`/g/${photo.short_id}/preview`} alt={photo.original_filename ?? photo.short_id} loading="lazy" />
              </a>
              <div class="work-source-meta">
                <span class="work-source-id">{photo.short_id}</span>
                <CopyIdButton value={photo.short_id} />
              </div>
              {photo.original_filename ? <span class="photo-name">{photo.original_filename}</span> : null}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
