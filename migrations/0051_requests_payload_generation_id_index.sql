-- カードの仕上げバッジ (lib/generations.ts) とワークベンチの pending (lib/workbench.ts) は payload の generation_id で
-- requests を引く。式索引が無いと毎回 requests を全件 scan する。クエリ側の式と一字一句同じでないと使われない。
CREATE INDEX idx_requests_payload_generation_id ON requests(json_extract(payload_json, '$.generation_id'));
