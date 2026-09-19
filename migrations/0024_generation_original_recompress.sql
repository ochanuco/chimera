-- 保持期間を過ぎて original を保持し続ける Generation を、再圧縮ジョブが評価済みであることを
-- 示す時刻 (src/lib/original-recompress.ts)。lossless WebP へ変換したかどうかに関わらず、
-- 一度評価すれば毎回スキャンし直さないためのマーカー。

ALTER TABLE generations ADD COLUMN original_recompress_checked_at TEXT;
