// batches.refines_generation_id の唯一の計算ロジック。B が G を refine するのは、B を target とする
// batch_relations(type='refinement', source=S) と batch_references(purpose='rebuild', source_generation=G)
// が対になり、G.batch_id = S であるとき (resolveDerivationSource と同じ対応)。複数一致時は最も早い
// rebuild reference (同時刻なら id の小さい方) を採る。migration の backfill もこの SQL 文字列を使う。

const REFINES_GENERATION_SUBQUERY = `
  SELECT rebuild.source_generation_id
  FROM batch_relations rel
  JOIN batch_references rebuild
    ON rebuild.target_batch_id = rel.target_batch_id AND rebuild.purpose = 'rebuild'
  JOIN generations g ON g.id = rebuild.source_generation_id
  WHERE rel.target_batch_id = batches.id AND rel.type = 'refinement' AND g.batch_id = rel.source_batch_id
  ORDER BY rebuild.created_at ASC, rebuild.id ASC
  LIMIT 1
`;

/** Builds the UPDATE statement, unexecuted, so callers append it to the same `db.batch` as the reference/relation INSERT (the subquery sees earlier rows in that batch, and a failure rolls back both). */
export function refinesGenerationUpdateStatement(db: D1Database, batchId: string): D1PreparedStatement {
  return db.prepare(`UPDATE batches SET refines_generation_id = (${REFINES_GENERATION_SUBQUERY}) WHERE id = ?`).bind(batchId);
}
