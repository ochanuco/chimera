-- 値が入らなくなった列を落とす。どちらも索引・外部キー・CHECK に使われていないので ALTER で落とせる。
ALTER TABLE tags DROP COLUMN description;
ALTER TABLE recipe_catalogs DROP COLUMN worker_id;
