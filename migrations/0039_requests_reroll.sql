-- リロール: 元絵 (raw Generation) を seed だけ変えて 4 枚振り直した generate Request が、その元絵を指す。元絵 1 枚につき 1 件。
ALTER TABLE requests ADD COLUMN reroll_of_generation_id TEXT;
CREATE UNIQUE INDEX idx_requests_reroll_of ON requests(reroll_of_generation_id) WHERE reroll_of_generation_id IS NOT NULL;
