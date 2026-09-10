/**
 * Tag chips (with remove buttons) + add-tag form, shared by Generation Detail's full page and
 * the Lightbox panel. `kind`/`id` address the tag API (`/api/v1/{kind}/{id}/tags`).
 */
// `<datalist id="tag-suggestions">` は呼び出し側のページテンプレートが1つだけ持つ
// (Gallery / BatchDetail / GenerationDetail)。Lightbox はページに重ねて描画されるため、
// ここで作ると同じidの重複要素になってしまう。
export function TagsEditor({ kind, id, tags }: { kind: string; id: string; tags: { id: string; name: string }[] }) {
  return (
    <>
      <div class="tag-chips">
        {tags.map((t) => (
          <span class="tag-chip">
            #{t.name}
            <button type="button" class="tag-remove-btn" data-kind={kind} data-id={id} data-tag-id={t.id}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form class="tag-add-form" data-kind={kind} data-id={id} data-removable="true">
        <input type="text" name="name" list="tag-suggestions" placeholder="add tag" />
        <button type="submit">+</button>
      </form>
    </>
  );
}
