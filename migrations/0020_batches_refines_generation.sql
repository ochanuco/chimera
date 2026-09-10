-- batches.refines_generation_id: B が finalize/repair/masked_redraw で仕上げた元の raw
-- Generation G。B を target とする batch_relations(type='refinement', source=S) と、B を
-- target とする batch_references(purpose='rebuild', source_generation=G) が対になり、
-- G.batch_id = S であるときに B refines G とする (src/lib/requests.ts の
-- resolveDerivationSource と同じ対応)。複数一致するときは最も早く作成された rebuild
-- reference を採り、作成時刻が同じなら id の小さい方を採る。ギャラリーの「finalize 以外」
-- 既定フィルタが raw/refined を分けるのに使う。
ALTER TABLE batches ADD COLUMN refines_generation_id TEXT REFERENCES generations(id);
CREATE INDEX idx_batches_refines_generation_id ON batches(refines_generation_id);

UPDATE batches
SET refines_generation_id = (
  SELECT rebuild.source_generation_id
  FROM batch_relations rel
  JOIN batch_references rebuild
    ON rebuild.target_batch_id = rel.target_batch_id AND rebuild.purpose = 'rebuild'
  JOIN generations g ON g.id = rebuild.source_generation_id
  WHERE rel.target_batch_id = batches.id AND rel.type = 'refinement' AND g.batch_id = rel.source_batch_id
  ORDER BY rebuild.created_at ASC, rebuild.id ASC
  LIMIT 1
);
