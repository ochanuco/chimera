/** Small inline button that copies `value` (a short_id or similar) to the clipboard. See appJs's initCopyIdButtons. */
export const CopyIdButton = ({ value }: { value: string }) => (
  <button type="button" class="copy-id-btn" data-copy-id={value} title={`Copy ${value}`} aria-label={`Copy ${value}`}>
    ⧉
  </button>
);
