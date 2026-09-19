-- 古い低価値 Generation の original.png を定期ジョブが削除した時刻 (src/lib/original-purge.ts)。
-- 行と preview.webp は残る — 消えるのは original オブジェクトだけ。

ALTER TABLE generations ADD COLUMN original_purged_at TEXT;
