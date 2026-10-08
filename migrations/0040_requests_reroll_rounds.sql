-- リロールは元絵ごとに何回でも振り直せる。0039 の UNIQUE をやめ、元絵からの引き当て用の通常 index にする。
DROP INDEX idx_requests_reroll_of;
CREATE INDEX idx_requests_reroll_of ON requests(reroll_of_generation_id) WHERE reroll_of_generation_id IS NOT NULL;
