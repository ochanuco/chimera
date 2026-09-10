// batches.refines_generation_id (migrations/0020_batches_refines_generation.sql) の
// 唯一の計算ロジック。B が G を refine するのは、B を target とする
// batch_relations(type='refinement', source=S) と、B を target とする
// batch_references(purpose='rebuild', source_generation=G) が対になり、G.batch_id = S
// であるとき (src/lib/requests.ts の resolveDerivationSource と同じ対応)。複数一致すると
// きは最も早く作成された rebuild reference を採る。
//
// routes/batches.ts の3箇所 (POST / の db.batch、POST /:id/references、
// POST /:targetBatchId/relations) がこれを使う。定義を1箇所にまとめるため、migration の
// backfill もこれと同じ SQL 文字列。

const REFINES_GENERATION_SUBQUERY = `
  SELECT rebuild.source_generation_id
  FROM batch_relations rel
  JOIN batch_references rebuild
    ON rebuild.target_batch_id = rel.target_batch_id AND rebuild.purpose = 'rebuild'
  JOIN generations g ON g.id = rebuild.source_generation_id
  WHERE rel.target_batch_id = batches.id AND rel.type = 'refinement' AND g.batch_id = rel.source_batch_id
  ORDER BY rebuild.created_at ASC
  LIMIT 1
`;

/**
 * Builds the UPDATE statement that recomputes `batchId`'s refines_generation_id. Returned
 * unexecuted so batch-create can append it to its own `db.batch` transaction (references /
 * refinement relation are inserted earlier in that same batch, so the subquery sees them).
 */
export function refinesGenerationUpdateStatement(db: D1Database, batchId: string): D1PreparedStatement {
  return db.prepare(`UPDATE batches SET refines_generation_id = (${REFINES_GENERATION_SUBQUERY}) WHERE id = ?`).bind(batchId);
}

/** Recomputes and persists `batchId`'s refines_generation_id immediately. Used after POST references / POST relations. */
export async function recomputeRefinesGeneration(db: D1Database, batchId: string): Promise<void> {
  await refinesGenerationUpdateStatement(db, batchId).run();
}
