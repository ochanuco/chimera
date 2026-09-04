-- グラフから抽出した構造化ファクト (checkpoint/sampler/canvas/lora/controlnet/seed) のキャッシュ。
-- NULL は「未抽出」を意味し、graph が存在すれば初回読み取り時に抽出して埋める
-- (src/lib/render-facts.ts の renderFactsForJob)。既存行の一括抽出は行わない。
ALTER TABLE comfy_jobs ADD COLUMN render_facts_json TEXT;
