// Batch 廃止の段階 1 (docs/batch-removal.md): Batch への書き込みを Request / Job / Generation の新しい列へ
// 同時に写す。Batch -> Request の対応は migrations/0026 の backfill と同じ規則:
// idempotency_key が 'request:' || requests.id でその Request が存在すれば、その Request。
// それ以外は id = batch.id の Request を補う (idempotency_key = 'batch:' || batch.id)。

/** `batches b` を参照する式。b に対応する Request の id。 */
const REQUEST_ID_FOR_BATCH = `COALESCE(
  (SELECT x.id FROM requests x WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END),
  b.id
)`;

const LINKED_REQUEST_EXISTS = `EXISTS (
  SELECT 1 FROM requests x
  WHERE x.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END
)`;

/**
 * 新規 Batch の Request 側の行。同じ `db.batch` で Batch の INSERT と refinesGenerationUpdateStatement の
 * 後ろに積む (kind は確定済みの refines_generation_id から決める)。
 * 対応する Request があればその列を更新し、無ければ補う。どちらか一方だけが効く。
 */
export function batchRequestStatements(db: D1Database, batchId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE requests
         SET short_id = b.short_id, recipe = b.recipe, raw_instruction = b.raw_instruction,
             parameters_json = b.parameters_json, patches_json = b.patches_json,
             pose_fingerprint = b.pose_fingerprint, preset_versions_json = b.preset_versions_json,
             git_commit = b.git_commit, git_dirty = b.git_dirty
         FROM batches b
         WHERE b.id = ? AND requests.id = CASE WHEN substr(b.idempotency_key, 1, 8) = 'request:' THEN substr(b.idempotency_key, 9) END`,
      )
      .bind(batchId),
    db
      .prepare(
        `INSERT INTO requests (
           id, kind, status, payload_json, payload_hash, recipe_ref, run_id, idempotency_key, created_by, created_at,
           updated_at, finished_at, short_id, recipe, raw_instruction, parameters_json, patches_json, pose_fingerprint,
           preset_versions_json, git_commit, git_dirty
         )
         SELECT
           b.id,
           CASE
             WHEN json_extract(b.parameters_json, '$.kind') IN ('repair', 'masked_redraw') THEN json_extract(b.parameters_json, '$.kind')
             WHEN b.refines_generation_id IS NOT NULL THEN 'finalize'
             WHEN json_extract(b.parameters_json, '$.kind') IS NOT NULL THEN 'import'
             ELSE 'generate'
           END,
           'done',
           json_object('schema_version', 1, 'legacy_batch_id', b.id),
           'backfill',
           'production',
           (SELECT er.id FROM experiment_runs er WHERE er.batch_id = b.id),
           'batch:' || b.id,
           'brain',
           b.created_at, b.updated_at, b.updated_at,
           b.short_id, b.recipe, b.raw_instruction, b.parameters_json, b.patches_json, b.pose_fingerprint,
           b.preset_versions_json, b.git_commit, b.git_dirty
         FROM batches b
         WHERE b.id = ? AND NOT ${LINKED_REQUEST_EXISTS}`,
      )
      .bind(batchId),
  ];
}

/** Batch に素材参照が足されたとき request_references に同じ id で写す。rebuild は仕上げ元として別に持つので写さない。 */
export function requestReferenceStatement(
  db: D1Database,
  ref: { id: string; batchId: string; generationId: string; purpose: string | null; aspect: string | null; instruction: string | null; createdAt: string },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO request_references (id, source_generation_id, target_request_id, purpose, aspect, instruction, created_at)
       SELECT ?, ?, ${REQUEST_ID_FOR_BATCH}, ?, ?, ?, ? FROM batches b WHERE b.id = ? AND ? IS NOT 'rebuild'`,
    )
    .bind(ref.id, ref.generationId, ref.purpose, ref.aspect, ref.instruction, ref.createdAt, ref.batchId, ref.purpose);
}

/** batches.refines_generation_id が再計算された後に、その Batch の Job / Generation へ写す。 */
export function propagateRefinesStatements(db: D1Database, batchId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        'UPDATE comfy_jobs SET source_generation_id = (SELECT refines_generation_id FROM batches WHERE id = ?1) WHERE batch_id = ?1',
      )
      .bind(batchId),
    db
      .prepare(
        'UPDATE generations SET refines_generation_id = (SELECT refines_generation_id FROM batches WHERE id = ?1) WHERE batch_id = ?1',
      )
      .bind(batchId),
  ];
}

/** Job 作成時の request_id / source_generation_id を求める副問い合わせ (batchId を ?1 に bind する)。 */
export const JOB_REQUEST_ID_SQL = `(SELECT ${REQUEST_ID_FOR_BATCH} FROM batches b WHERE b.id = ?)`;
export const JOB_SOURCE_GENERATION_ID_SQL = '(SELECT refines_generation_id FROM batches WHERE id = ?)';

/** Request 完了時の preset pin を Batch の Request に写す。 */
export function presetVersionsStatement(db: D1Database, batchId: string, presetVersionsJson: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE requests SET preset_versions_json = ?
       WHERE id = (SELECT ${REQUEST_ID_FOR_BATCH} FROM batches b WHERE b.id = ?)`,
    )
    .bind(presetVersionsJson, batchId);
}

/** Run に Batch を attach したとき、補った Request (key が 'batch:...') にだけ run_id を付ける。worker 由来の Request は起票時に run_id を持つ。 */
export function runAttachStatement(db: D1Database, batchId: string, runId: string): D1PreparedStatement {
  return db
    .prepare("UPDATE requests SET run_id = ? WHERE idempotency_key = 'batch:' || ? AND run_id IS NULL")
    .bind(runId, batchId);
}
