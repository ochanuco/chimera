import { Hono } from 'hono';
import {
  createExperimentSchema,
  updateExperimentSchema,
  createExperimentRunSchema,
  updateExperimentRunSchema,
  createPromotionSchema,
  updatePromotionSchema,
} from '../schemas/experiments';
import { assignTagSchema } from '../schemas/tags';
import { isUuid, uuidv7 } from '../lib/uuidv7';
import {
  getBatchByIdOrShortId,
  getExperimentByIdOrShortId,
  getGenerationByIdOrShortId,
  nowIso,
  parsePagination,
  resolveBatchThumbnails,
} from '../lib/db';
import { createUniqueShortId } from '../lib/shortid';
import { assignTag, listTagsForTarget, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  generationImageUrl,
  serializeExperiment,
  serializeExperimentPromotion,
  serializeExperimentRun,
  serializeGenerationLight,
} from '../lib/serialize';
import type {
  AppEnv,
  ExperimentPromotionRow,
  ExperimentRow,
  ExperimentRunRow,
  ExperimentStatus,
  GenerationRow,
  PromotionStatus,
} from '../types';

export const experiments = new Hono<AppEnv>();
/** Mounted at /api/v1/experiment-runs: Run は Experiment を跨いで一意なので直接引ける。 */
export const experimentRuns = new Hono<AppEnv>();
/** Mounted at /api/v1/promotions. */
export const promotions = new Hono<AppEnv>();

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

/**
 * 検証テーマとしての Experiment の状態遷移。`active` を離れた時点で
 * `completed_at` が立ち、`active` へ戻すと消える（再開できる）。
 * `stabilized -> promoted` では最初に完了した時刻を保つ。
 */
const EXPERIMENT_STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  active: ['stabilized', 'abandoned'],
  stabilized: ['promoted', 'active', 'abandoned'],
  promoted: ['active'],
  abandoned: ['active'],
};

/** proposed からのみ確定でき、applied / rejected は終端。 */
const PROMOTION_STATUS_TRANSITIONS: Record<PromotionStatus, PromotionStatus[]> = {
  proposed: ['applied', 'rejected'],
  applied: [],
  rejected: [],
};

async function getExperimentOr404(db: D1Database, idOrShortId: string): Promise<ExperimentRow> {
  const row = await getExperimentByIdOrShortId(db, idOrShortId);
  if (!row) throw notFound('experiment');
  return row;
}

async function getRunOr404(db: D1Database, id: string): Promise<ExperimentRunRow> {
  const row = await db.prepare('SELECT * FROM experiment_runs WHERE id = ?').bind(id).first<ExperimentRunRow>();
  if (!row) throw notFound('experiment run');
  return row;
}

async function getPromotionOr404(db: D1Database, id: string): Promise<ExperimentPromotionRow> {
  const row = await db
    .prepare('SELECT * FROM experiment_promotions WHERE id = ?')
    .bind(id)
    .first<ExperimentPromotionRow>();
  if (!row) throw notFound('promotion');
  return row;
}

/** Run / Promotion の追加・更新も Experiment の「最終活動時刻」なので updated_at を進める。 */
async function touchExperiment(db: D1Database, experimentId: string, at: string): Promise<void> {
  await db.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').bind(at, experimentId).run();
}

async function assertCharacterExists(db: D1Database, characterId: string): Promise<void> {
  const found = await db.prepare('SELECT 1 FROM characters WHERE id = ?').bind(characterId).first();
  if (!found) throw notFound('character');
}

// --- Experiment ---

experiments.post('/', async (c) => {
  const body = createExperimentSchema.parse(await c.req.json());
  const db = c.env.DB;
  if (body.character_id) await assertCharacterExists(db, body.character_id);

  const now = nowIso();
  const row: ExperimentRow = {
    id: uuidv7(),
    short_id: await createUniqueShortId(db, 'experiments'),
    name: body.name,
    description: body.description ?? null,
    note: body.note ?? null,
    status: 'active',
    base_recipe: body.base_recipe ?? null,
    character_id: body.character_id ?? null,
    bookmark: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  await db
    .prepare(
      `INSERT INTO experiments
         (id, short_id, name, description, note, status, base_recipe, character_id, bookmark, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.short_id,
      row.name,
      row.description,
      row.note,
      row.status,
      row.base_recipe,
      row.character_id,
      row.bookmark,
      row.created_at,
      row.updated_at,
      row.completed_at,
    )
    .run();
  return c.json(serializeExperiment(row), 201);
});

experiments.get('/', async (c) => {
  const db = c.env.DB;
  const query = c.req.query();
  const { limit, offset } = parsePagination(query);

  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (query.status) {
    conditions.push('e.status = ?');
    binds.push(query.status);
  }
  if (query.character) {
    if (isUuid(query.character)) {
      conditions.push('e.character_id = ?');
      binds.push(query.character);
    } else {
      conditions.push('e.character_id IN (SELECT id FROM characters WHERE name = ?)');
      binds.push(query.character);
    }
  }
  if (query.bookmark === 'true') conditions.push('e.bookmark = 1');
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await db
    .prepare(
      `SELECT e.*, ch.name AS character_name,
         (SELECT COUNT(*) FROM experiment_runs r WHERE r.experiment_id = e.id) AS run_count
       FROM experiments e
       LEFT JOIN characters ch ON ch.id = e.character_id
       ${where}
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<ExperimentRow & { character_name: string | null; run_count: number }>();

  const rows = results ?? [];
  const latestRuns = await latestRunByExperiment(db, rows.map((r) => r.id));

  return c.json({
    items: rows.map((r) => {
      const latest = latestRuns.get(r.id);
      return {
        ...serializeExperiment(r),
        character: r.character_id ? { id: r.character_id, name: r.character_name } : null,
        run_count: r.run_count,
        latest_run: latest
          ? {
              id: latest.id,
              run_index: latest.run_index,
              created_at: latest.created_at,
              evaluation_overall: evaluationOverall(latest),
            }
          : null,
      };
    }),
  });
});

/** 一覧の「latest result」用。Run 1件あたりの評価全文は返さず overall だけ拾う。 */
function evaluationOverall(run: ExperimentRunRow): string | null {
  if (!run.evaluation_json) return null;
  try {
    const parsed = JSON.parse(run.evaluation_json) as { overall?: unknown };
    return typeof parsed.overall === 'string' ? parsed.overall : null;
  } catch {
    return null;
  }
}

async function latestRunByExperiment(
  db: D1Database,
  experimentIds: string[],
): Promise<Map<string, ExperimentRunRow>> {
  const unique = Array.from(new Set(experimentIds));
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.experiment_id ORDER BY r.run_index DESC) AS rn
         FROM experiment_runs r
         WHERE r.experiment_id IN (${placeholders})
       ) WHERE rn = 1`,
    )
    .bind(...unique)
    .all<ExperimentRunRow>();
  return new Map((results ?? []).map((r) => [r.experiment_id, r]));
}

/**
 * Run に紐づく Batch / Generation を1回のクエリずつで解決する。Generation
 * 未 attach でも Batch の代表 Generation をサムネイルに使えるようにする。
 */
async function decorateRuns(db: D1Database, runs: ExperimentRunRow[], org: string) {
  const batchIds = runs.map((r) => r.batch_id).filter((id): id is string => id !== null);
  const generationIds = runs.map((r) => r.generation_id).filter((id): id is string => id !== null);

  const batchMap = new Map<string, { id: string; short_id: string }>();
  if (batchIds.length > 0) {
    const placeholders = batchIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, short_id FROM batches WHERE id IN (${placeholders})`)
      .bind(...batchIds)
      .all<{ id: string; short_id: string }>();
    for (const row of results ?? []) batchMap.set(row.id, row);
  }

  const generationMap = new Map<string, GenerationRow>();
  if (generationIds.length > 0) {
    const placeholders = generationIds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT * FROM generations WHERE id IN (${placeholders})`)
      .bind(...generationIds)
      .all<GenerationRow>();
    for (const row of results ?? []) generationMap.set(row.id, row);
  }

  const batchThumbnails = await resolveBatchThumbnails(db, batchIds);

  return runs.map((run) => {
    const batch = run.batch_id ? batchMap.get(run.batch_id) ?? null : null;
    const thumbShortId = run.batch_id ? batchThumbnails.get(run.batch_id) ?? null : null;
    const generation = run.generation_id ? generationMap.get(run.generation_id) ?? null : null;
    return {
      ...serializeExperimentRun(run),
      batch: batch
        ? {
            id: batch.id,
            short_id: batch.short_id,
            thumbnail_url: thumbShortId ? generationImageUrl(org, thumbShortId) : null,
          }
        : null,
      generation: generation ? serializeGenerationLight(generation, org) : null,
    };
  });
}

async function listRuns(db: D1Database, experimentId: string): Promise<ExperimentRunRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM experiment_runs WHERE experiment_id = ? ORDER BY run_index ASC')
    .bind(experimentId)
    .all<ExperimentRunRow>();
  return results ?? [];
}

async function listPromotions(db: D1Database, experimentId: string): Promise<ExperimentPromotionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM experiment_promotions WHERE experiment_id = ? ORDER BY created_at ASC')
    .bind(experimentId)
    .all<ExperimentPromotionRow>();
  return results ?? [];
}

experiments.get('/:id', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const org = origin(c);

  const [runRows, promotionRows, tags, character] = await Promise.all([
    listRuns(db, experiment.id),
    listPromotions(db, experiment.id),
    listTagsForTarget(db, 'experiment_tags', experiment.id),
    experiment.character_id
      ? db
          .prepare('SELECT id, name FROM characters WHERE id = ?')
          .bind(experiment.character_id)
          .first<{ id: string; name: string }>()
      : Promise.resolve(null),
  ]);

  return c.json({
    ...serializeExperiment(experiment),
    character: character ?? null,
    tags: tags.map((t) => t.name),
    run_count: runRows.length,
    runs: await decorateRuns(db, runRows, org),
    promotions: promotionRows.map(serializeExperimentPromotion),
  });
});

experiments.patch('/:id', async (c) => {
  const body = updateExperimentSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  if (body.character_id) await assertCharacterExists(db, body.character_id);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if (body.name !== undefined) assign('name', body.name);
  if (body.description !== undefined) assign('description', body.description);
  if (body.note !== undefined) assign('note', body.note);
  if (body.base_recipe !== undefined) assign('base_recipe', body.base_recipe);
  if (body.character_id !== undefined) assign('character_id', body.character_id);

  const now = nowIso();
  if (body.status !== undefined && body.status !== experiment.status) {
    if (!EXPERIMENT_STATUS_TRANSITIONS[experiment.status].includes(body.status)) {
      throw conflict(`cannot change experiment status from '${experiment.status}' to '${body.status}'`);
    }
    assign('status', body.status);
    if (body.status === 'active') {
      assign('completed_at', null);
    } else if (experiment.status === 'active') {
      assign('completed_at', now);
    }
  }

  assign('updated_at', now);
  binds.push(experiment.id);
  await db.prepare(`UPDATE experiments SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const updated = await getExperimentOr404(db, experiment.id);
  return c.json(serializeExperiment(updated));
});

// --- ExperimentRun ---

experiments.post('/:id/runs', async (c) => {
  const body = createExperimentRunSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));

  let parentRunId: string | null = null;
  if (body.parent_run_id) {
    const parent = await getRunOr404(db, body.parent_run_id);
    if (parent.experiment_id !== experiment.id) {
      throw badRequest('parent_run_id belongs to a different experiment');
    }
    parentRunId = parent.id;
  }

  const batchId = body.batch_id ? (await resolveBatchOr404(db, body.batch_id)).id : null;
  const generationId = body.generation_id ? (await resolveGenerationOr404(db, body.generation_id)).id : null;

  const next = await db
    .prepare('SELECT COALESCE(MAX(run_index), 0) + 1 AS next FROM experiment_runs WHERE experiment_id = ?')
    .bind(experiment.id)
    .first<{ next: number }>();

  const now = nowIso();
  const row: ExperimentRunRow = {
    id: uuidv7(),
    experiment_id: experiment.id,
    run_index: next?.next ?? 1,
    parent_run_id: parentRunId,
    batch_id: batchId,
    generation_id: generationId,
    overrides_json: JSON.stringify(body.overrides ?? {}),
    objective: body.objective ?? null,
    evaluation_json: body.evaluation ? JSON.stringify(body.evaluation) : null,
    decision_json: body.decision ? JSON.stringify(body.decision) : null,
    note: body.note ?? null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO experiment_runs
         (id, experiment_id, run_index, parent_run_id, batch_id, generation_id, overrides_json,
          objective, evaluation_json, decision_json, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.experiment_id,
      row.run_index,
      row.parent_run_id,
      row.batch_id,
      row.generation_id,
      row.overrides_json,
      row.objective,
      row.evaluation_json,
      row.decision_json,
      row.note,
      row.created_at,
      row.updated_at,
    )
    .run();
  await touchExperiment(db, experiment.id, now);

  return c.json(serializeExperimentRun(row), 201);
});

experiments.get('/:id/runs', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const runs = await listRuns(db, experiment.id);
  return c.json({ items: await decorateRuns(db, runs, origin(c)) });
});

async function resolveBatchOr404(db: D1Database, idOrShortId: string) {
  const batch = await getBatchByIdOrShortId(db, idOrShortId);
  if (!batch) throw notFound(`batch '${idOrShortId}'`);
  return batch;
}

async function resolveGenerationOr404(db: D1Database, idOrShortId: string) {
  const generation = await getGenerationByIdOrShortId(db, idOrShortId);
  if (!generation) throw notFound(`generation '${idOrShortId}'`);
  return generation;
}

experimentRuns.get('/:runId', async (c) => {
  const db = c.env.DB;
  const run = await getRunOr404(db, c.req.param('runId'));
  const experiment = await getExperimentOr404(db, run.experiment_id);
  const [decorated] = await decorateRuns(db, [run], origin(c));
  return c.json({
    ...decorated,
    experiment: {
      id: experiment.id,
      short_id: experiment.short_id,
      name: experiment.name,
      status: experiment.status,
      base_recipe: experiment.base_recipe,
      character_id: experiment.character_id,
    },
  });
});

experimentRuns.patch('/:runId', async (c) => {
  const body = updateExperimentRunSchema.parse(await c.req.json());
  const db = c.env.DB;
  const run = await getRunOr404(db, c.req.param('runId'));

  const sets: string[] = [];
  const binds: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  if (body.overrides !== undefined) {
    // 生成結果が付いた Run の overrides を書き換えると「何がその画像を生んだか」の
    // 記録が失われる。付け替えたい場合は新しい Run を作る。
    if (run.batch_id || run.generation_id) {
      throw conflict('overrides cannot be changed after a batch or generation is attached; create a new run instead');
    }
    assign('overrides_json', JSON.stringify(body.overrides));
  }
  if (body.batch_id !== undefined) {
    const batch = await resolveBatchOr404(db, body.batch_id);
    if (run.batch_id && run.batch_id !== batch.id) {
      throw conflict('run already has a batch attached');
    }
    assign('batch_id', batch.id);
  }
  if (body.generation_id !== undefined) {
    const generation = await resolveGenerationOr404(db, body.generation_id);
    if (run.generation_id && run.generation_id !== generation.id) {
      throw conflict('run already has a generation attached');
    }
    assign('generation_id', generation.id);
  }
  if (body.objective !== undefined) assign('objective', body.objective);
  if (body.evaluation !== undefined) {
    assign('evaluation_json', body.evaluation === null ? null : JSON.stringify(body.evaluation));
  }
  if (body.decision !== undefined) {
    assign('decision_json', body.decision === null ? null : JSON.stringify(body.decision));
  }
  if (body.note !== undefined) assign('note', body.note);

  const now = nowIso();
  assign('updated_at', now);
  binds.push(run.id);
  await db.prepare(`UPDATE experiment_runs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  await touchExperiment(db, run.experiment_id, now);

  const updated = await getRunOr404(db, run.id);
  return c.json(serializeExperimentRun(updated));
});

// --- Promotion ---

experiments.post('/:id/promotions', async (c) => {
  const body = createPromotionSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));

  let sourceRun: ExperimentRunRow | null = null;
  if (body.source_run_id) {
    sourceRun = await getRunOr404(db, body.source_run_id);
    if (sourceRun.experiment_id !== experiment.id) {
      throw badRequest('source_run_id belongs to a different experiment');
    }
  }

  // 昇格対象の override を明示しなければ、source run のものをそのまま昇格させる。
  const promotedOverrides = body.promoted_overrides
    ? JSON.stringify(body.promoted_overrides)
    : sourceRun?.overrides_json ?? '{}';

  const now = nowIso();
  const row: ExperimentPromotionRow = {
    id: uuidv7(),
    experiment_id: experiment.id,
    source_run_id: sourceRun?.id ?? null,
    promoted_overrides_json: promotedOverrides,
    status: 'proposed',
    target_repository: body.target_repository,
    target_path: body.target_path ?? null,
    commit_sha: body.commit_sha ?? null,
    pull_request_url: body.pull_request_url ?? null,
    note: body.note ?? null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };

  await db
    .prepare(
      `INSERT INTO experiment_promotions
         (id, experiment_id, source_run_id, promoted_overrides_json, status, target_repository,
          target_path, commit_sha, pull_request_url, note, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.experiment_id,
      row.source_run_id,
      row.promoted_overrides_json,
      row.status,
      row.target_repository,
      row.target_path,
      row.commit_sha,
      row.pull_request_url,
      row.note,
      row.created_at,
      row.updated_at,
      row.completed_at,
    )
    .run();
  await touchExperiment(db, experiment.id, now);

  return c.json(serializeExperimentPromotion(row), 201);
});

experiments.get('/:id/promotions', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const rows = await listPromotions(db, experiment.id);
  return c.json({ items: rows.map(serializeExperimentPromotion) });
});

promotions.get('/:promotionId', async (c) => {
  const row = await getPromotionOr404(c.env.DB, c.req.param('promotionId'));
  return c.json(serializeExperimentPromotion(row));
});

promotions.patch('/:promotionId', async (c) => {
  const body = updatePromotionSchema.parse(await c.req.json());
  const db = c.env.DB;
  const promotion = await getPromotionOr404(db, c.req.param('promotionId'));

  const sets: string[] = [];
  const binds: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    binds.push(value);
  };

  const now = nowIso();
  if (body.status !== undefined && body.status !== promotion.status) {
    if (!PROMOTION_STATUS_TRANSITIONS[promotion.status].includes(body.status)) {
      throw conflict(`cannot change promotion status from '${promotion.status}' to '${body.status}'`);
    }
    assign('status', body.status);
    assign('completed_at', now);
  }
  if (body.promoted_overrides !== undefined) {
    if (promotion.status !== 'proposed') {
      throw conflict('promoted_overrides cannot be changed once the promotion is applied or rejected');
    }
    assign('promoted_overrides_json', JSON.stringify(body.promoted_overrides));
  }
  if (body.target_repository !== undefined) assign('target_repository', body.target_repository);
  if (body.target_path !== undefined) assign('target_path', body.target_path);
  if (body.commit_sha !== undefined) assign('commit_sha', body.commit_sha);
  if (body.pull_request_url !== undefined) assign('pull_request_url', body.pull_request_url);
  if (body.note !== undefined) assign('note', body.note);

  assign('updated_at', now);
  binds.push(promotion.id);
  await db.prepare(`UPDATE experiment_promotions SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  await touchExperiment(db, promotion.experiment_id, now);

  const updated = await getPromotionOr404(db, promotion.id);
  return c.json(serializeExperimentPromotion(updated));
});

// --- Bookmark / Tag ---

experiments.put('/:id/bookmark', async (c) => {
  const experiment = await getExperimentOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'experiments', experiment.id, true);
  return c.json({ bookmark: true });
});

experiments.delete('/:id/bookmark', async (c) => {
  const experiment = await getExperimentOr404(c.env.DB, c.req.param('id'));
  await setBookmark(c.env.DB, 'experiments', experiment.id, false);
  return c.json({ bookmark: false });
});

experiments.post('/:id/tags', async (c) => {
  const body = assignTagSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const { tag, created } = await assignTag(db, 'experiment_tags', experiment.id, body.name, body.created_by);
  return c.json({ id: tag.id, name: tag.name }, created ? 201 : 200);
});

experiments.delete('/:id/tags/:tagId', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  await removeTag(db, 'experiment_tags', experiment.id, c.req.param('tagId'));
  return c.body(null, 204);
});
