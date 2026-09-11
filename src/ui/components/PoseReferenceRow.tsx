export interface PoseReferenceData {
  recipe: string;
  pose: string;
}

/**
 * 「基準」行 (docs/ui.md「Lightbox」/「Generation Detail」): rating/bookmark 行の直後に置く、
 * Generation Detail のフルページと Lightbox パネルの両方から使う共有コンポーネント。pin 済みなら
 * pill を、未pinなら POST /api/v1/generations/{id}/pose-reference を呼ぶボタンを出す。JS側の
 * 書き換え (initPoseReference, src/ui/static.ts) はこの markup と同じ形を組み立てる。
 */
export function PoseReferenceRow({ generationId, poseReference }: { generationId: string; poseReference: PoseReferenceData | null }) {
  return (
    <div class="pose-reference-row" data-generation-id={generationId}>
      {poseReference ? (
        <span class="card-reference-pill" title={`${poseReference.recipe} の ${poseReference.pose} の基準 render`}>
          基準 {poseReference.pose}
        </span>
      ) : (
        <button
          type="button"
          class="pose-reference-btn"
          data-generation-id={generationId}
          title="この render を pose の基準に pin する（rating good が必要）"
        >
          基準にする
        </button>
      )}
    </div>
  );
}
