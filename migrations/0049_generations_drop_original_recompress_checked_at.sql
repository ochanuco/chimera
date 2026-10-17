-- original 再圧縮ジョブの撤去に伴い、評価済みの印だった original_recompress_checked_at を落とす。
-- この列を参照する索引・ビュー・トリガは無い。
ALTER TABLE generations DROP COLUMN original_recompress_checked_at;
