-- ワークベンチ: 元絵（raw Generation）1 枚につき 1 行。picks_json は {"1": {"generation_id": "<id>"} | {"skip": true}, ...}。
CREATE TABLE workbenches (
  id TEXT PRIMARY KEY,
  root_generation_id TEXT NOT NULL UNIQUE REFERENCES generations(id),
  picks_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
