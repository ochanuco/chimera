/** `Note` section shared by Generation Detail's full page (open) and the Lightbox panel (collapsed). */
export function NoteSection({ kind, id, note, open = true }: { kind: string; id: string; note: string | null; open?: boolean }) {
  return (
    <details class="section" open={open}>
      <summary>Note</summary>
      <div class="section-body">
        <form class="note-form" data-kind={kind} data-id={id}>
          <textarea name="note">{note ?? ''}</textarea>
          <br />
          <button type="submit">Save</button>
          <span class="save-status"></span>
        </form>
      </div>
    </details>
  );
}
