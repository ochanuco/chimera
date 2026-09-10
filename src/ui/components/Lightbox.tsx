import { CopyIdButton } from './CopyIdButton';
import { FinalizeSection, type FinalizeRequestStatusLine } from './FinalizeSection';
import { NoteSection } from './NoteSection';
import { PublicationSection, type PublicationData } from './PublicationSection';
import { RatingBookmark } from './RatingBookmark';
import { TagsEditor } from './TagsEditor';

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

/**
 * Lightbox right-hand panel. Fetched as a fragment (`GET /g/:short_id?partial=lightbox`, no
 * `<html>`) and injected by appJs's lightbox controller; the actual `<img>` and the desktop
 * overlay/prev-next chrome are built client-side (the clicked card already holds the full-res
 * image URL, see `initThumbPreview`). Reuses the same section components as Generation Detail
 * (docs/ui.md「Lightbox」) so behaviour stays in one place.
 */
export function LightboxPanel({
  generationId,
  shortId,
  imageMetaText,
  refinesGenerationShortId,
  rating,
  bookmark,
  publications,
  tags,
  recipe,
  finalizeRequests,
  note,
}: {
  generationId: string;
  shortId: string;
  imageMetaText: string | null;
  refinesGenerationShortId: string | null;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  publications: PublicationData[];
  tags: { id: string; name: string }[];
  recipe: string | null;
  finalizeRequests: FinalizeRequestStatusLine[];
  note: string | null;
}) {
  return (
    <div class="lightbox-panel-content" data-generation-id={generationId} data-short-id={shortId}>
      <div class="lightbox-header">
        <span class="lightbox-short-id">{shortId}</span>
        <CopyIdButton value={shortId} />
        <div class="lightbox-header-actions">
          <button type="button" class="compare-add-btn" data-generation-id={generationId} data-short-id={shortId}>
            比較に追加
          </button>
          <button type="button" class="lightbox-close" aria-label="close">
            <CloseIcon />
          </button>
        </div>
      </div>

      <p class="lightbox-meta-row">
        {imageMetaText ? <span class="image-meta lightbox-image-meta">{imageMetaText}</span> : null}
        <a href={`/g/${shortId}`}>詳細ページ ↗</a>
      </p>

      {refinesGenerationShortId ? (
        <p class="lightbox-from-row">
          <a class="card-from-badge card-from-badge-link" href={`/g/${refinesGenerationShortId}`}>
            from <span class="card-from-badge-id">{refinesGenerationShortId}</span>
          </a>
        </p>
      ) : null}

      <RatingBookmark id={generationId} rating={rating} bookmark={bookmark} size="lg" />

      <PublicationSection generationId={generationId} publications={publications} />

      <TagsEditor kind="generations" id={generationId} tags={tags} />

      <FinalizeSection shortId={shortId} recipe={recipe} requests={finalizeRequests} open />

      <NoteSection kind="generations" id={generationId} note={note} open={false} />
    </div>
  );
}
