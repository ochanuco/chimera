/** Tag chips (with remove buttons) + add-tag form. `kind`/`id` address the tag API (`/api/v1/{kind}/{id}/tags`). */
// `<datalist id="tag-suggestions">` は呼び出し側のページテンプレート (Gallery / BatchDetail / GenerationDetail) が1つだけ持つ。ここで作ると重複idになる。
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
