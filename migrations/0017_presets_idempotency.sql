-- promote (POST /api/v1/presets/promote) は idempotency_key の再送で同じ版を返す必要が
-- あるため presets 側にも持たせる。import 由来の行 (0016) は idempotency_key を持たず
-- NULL のままにする — SQLite の UNIQUE index は NULL 同士を重複と見なさないので、
-- NULL を許したまま一意制約として使える。

ALTER TABLE presets ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_presets_idempotency_key ON presets (idempotency_key);
