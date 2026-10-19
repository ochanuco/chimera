ALTER TABLE generations ADD COLUMN model_family TEXT;

-- raw Generation: Job の render_facts_json.$.checkpoints から決める (src/lib/model-family.ts と同じ規則)。
UPDATE generations
SET model_family = (
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM json_each(j.render_facts_json, '$.checkpoints') WHERE lower(value) LIKE '%moss%') THEN 'moss'
    WHEN EXISTS (SELECT 1 FROM json_each(j.render_facts_json, '$.checkpoints') WHERE lower(value) LIKE '%anima%' AND lower(value) NOT LIKE '%animagine%') THEN 'anima'
    WHEN EXISTS (SELECT 1 FROM json_each(j.render_facts_json, '$.checkpoints')) THEN 'il'
    ELSE NULL
  END
  FROM comfy_jobs j
  WHERE j.id = generations.comfy_job_id AND json_valid(j.render_facts_json)
)
WHERE refines_generation_id IS NULL;

-- 仕上げ済み Generation: refines チェーンの根 (raw) の系統を引き継ぐ。
WITH RECURSIVE chain(id, root_id) AS (
  SELECT id, refines_generation_id FROM generations WHERE refines_generation_id IS NOT NULL
  UNION ALL
  SELECT chain.id, g.refines_generation_id
  FROM chain JOIN generations g ON g.id = chain.root_id
  WHERE g.refines_generation_id IS NOT NULL
)
UPDATE generations
SET model_family = (
  SELECT r.model_family
  FROM chain c JOIN generations r ON r.id = c.root_id
  WHERE c.id = generations.id AND r.refines_generation_id IS NULL
)
WHERE refines_generation_id IS NOT NULL;
