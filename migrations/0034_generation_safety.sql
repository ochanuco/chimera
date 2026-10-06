-- Raw content-rating scores (WD tagger) per Generation. The verdict is computed at read time
-- (src/lib/safety.ts) so thresholds can change without re-rating.

CREATE TABLE generation_safety (
  generation_id TEXT PRIMARY KEY REFERENCES generations(id),
  model TEXT NOT NULL,
  rating_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  rated_at TEXT NOT NULL
);
