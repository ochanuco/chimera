/** 「hires 刷り直し」行 (docs/ui.md「Generation Detail」): 同 prompt・同 seed で hires 2048 を足した generate Request を
 * POST /api/v1/generations/{id}/hires で積む。JS側 (initHiresRerender, src/ui/static.ts) が data 属性を読む。 */
export function HiresRerenderRow({ generationId, shortId }: { generationId: string; shortId: string }) {
  return (
    <div class="hires-rerender-row" data-generation-id={generationId} data-generation-short-id={shortId}>
      <select class="hires-denoise" aria-label="hires denoise">
        <option value="0.35" selected>
          0.35 構図を保つ
        </option>
        <option value="0.45">0.45 線まで描き直す</option>
      </select>
      <button type="button" class="hires-rerender-btn" title="同じ prompt・同じ seed で latent upscale して描き直す">
        hires 2048 で刷り直す
      </button>
      <span class="hires-rerender-status" role="status"></span>
    </div>
  );
}
