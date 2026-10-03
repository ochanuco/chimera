-- Batch 廃止: Batch / Story の表を消す。読み書きするコードはもう無い。
-- Batch の note は、対応する Request の最初の Generation の note へ追記してから消す。
PRAGMA defer_foreign_keys = true;

-- Batch の note を、対応する Request の最初の Generation の note へ追記する。
-- 最初の Generation の選び方は resolveRequestThumbnails (src/lib/db.ts) と同じ。
UPDATE generations
SET note = CASE WHEN generations.note IS NULL OR generations.note = '' THEN t.note ELSE generations.note || char(10) || char(10) || t.note END
FROM (
  SELECT gid, group_concat(note, char(10) || char(10)) AS note
  FROM (
    SELECT
      b.note AS note,
      (SELECT g.id FROM generations g JOIN comfy_jobs j ON j.id = g.comfy_job_id
        WHERE g.request_id = (SELECT g2.request_id FROM generations g2 WHERE g2.batch_id = b.id LIMIT 1)
        ORDER BY j.job_index ASC, g.comfy_output_index ASC, g.created_at ASC, g.id ASC LIMIT 1) AS gid
    FROM batches b
    WHERE b.note IS NOT NULL AND b.note != ''
  )
  WHERE gid IS NOT NULL
  GROUP BY gid
) t
WHERE generations.id = t.gid;

DROP TABLE batch_tags;
DROP TABLE story_tags;
DROP TABLE batch_references;
DROP TABLE batch_relations;
DROP TABLE story_relations;
DROP TABLE batches;
DROP TABLE stories;
