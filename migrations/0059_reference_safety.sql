-- Raw content-rating scores (WD tagger) of a reference picture, sent by the worker after analysis.
-- The verdict is computed at read time (src/lib/safety.ts). A picture whose verdict is readable
-- stays in R2 until the 24 h sweep so an agent can look at it; others are deleted at once.

CREATE TABLE reference_safety (
  request_id TEXT PRIMARY KEY REFERENCES requests(id),
  model TEXT NOT NULL,
  rating_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  rated_at TEXT NOT NULL
);
