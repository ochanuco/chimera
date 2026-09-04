import { Hono } from 'hono';
import {
  createExperimentSchema,
  updateExperimentSchema,
  createExperimentRunSchema,
  updateExperimentRunSchema,
  createPromotionSchema,
  updatePromotionSchema,
  createJudgmentSchema,
  experimentStatusSchema,
} from '../schemas/experiments';
import { assignTagSchema } from '../schemas/tags';
import { uuidv7 } from '../lib/uuidv7';
import { nowIso, parsePagination } from '../lib/db';
import { createUniqueShortId } from '../lib/shortid';
import { EXPERIMENT_STATUS_TRANSITIONS } from '../lib/experiment-status';
import { assignTag, removeTag } from '../lib/tags';
import { setBookmark } from '../lib/bookmark';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  createExperimentRun,
  decorateRuns,
  evaluationOverall,
  getExperimentDetail,
  getExperimentOr404,
  getRunOr404,
  getRunWithExperimentContext,
  latestRunByExperiment,
  listPendingRuns,
  listPromotions,
  listRuns,
  queryExperiments,
  serializePendingRun,
  touchExperiment,
  updateExperimentRun,
} from '../lib/experiments';
import { createJudgment, judgmentSummary, listJudgments } from '../lib/judgments';
import {
  serializeExperiment,
  serializeExperimentPromotion,
  serializeExperimentRun,
  serializePairwiseJudgment,
} from '../lib/serialize';
import type { AppEnv, ExperimentPromotionRow, ExperimentRow, ExperimentRunRow, PromotionStatus } from '../types';

export const experiments = new Hono<AppEnv>();
/** Mounted at /api/v1/experiment-runs: Run は Experiment を跨いで一意なので直接引ける。 */
export const experimentRuns = new Hono<AppEnv>();
/** Mounted at /api/v1/promotions. */
export const promotions = new Hono<AppEnv>();

function origin(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin;
}

/** proposed からのみ確定でき、applied / rejected は終端。 */
const PROMOTION_STATUS_TRANSITIONS: Record<PromotionStatus, PromotionStatus[]> = {
  proposed: ['applied', 'rejected'],
  applied: [],
  rejected: [],
};

async function getPromotionOr404(db: D1Database, id: string): Promise<ExperimentPromotionRow> {
  const row = await db
    .prepare('SELECT * FROM experiment_promotions WHERE id = ?')
    .bind(id)
    .first<ExperimentPromotionRow>();
  if (!row) throw notFound('promotion');
  return row;
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
    base_parameters_json: body.base_parameters ? JSON.stringify(body.base_parameters) : null,
    character_id: body.character_id ?? null,
    bookmark: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  await db
    .prepare(
      `INSERT INTO experiments
         (id, short_id, name, description, note, status, base_recipe, base_parameters_json, character_id, bookmark, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.short_id,
      row.name,
      row.description,
      row.note,
      row.status,
      row.base_recipe,
      row.base_parameters_json,
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

  let status: ReturnType<typeof experimentStatusSchema.parse> | undefined;
  if (query.status) {
    const parsed = experimentStatusSchema.safeParse(query.status);
    if (!parsed.success) throw badRequest(`invalid status '${query.status}'`);
    status = parsed.data;
  }

  const rows = await queryExperiments(
    db,
    { status, character: query.character, bookmark: query.bookmark === 'true' },
    limit,
    offset,
  );
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

experiments.get('/:id', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  return c.json(await getExperimentDetail(db, experiment, origin(c)));
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
  if (body.base_parameters !== undefined) {
    assign('base_parameters_json', body.base_parameters === null ? null : JSON.stringify(body.base_parameters));
  }
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
  const { row, created } = await createExperimentRun(db, experiment, body);
  return c.json(serializeExperimentRun(row), created ? 201 : 200);
});

experiments.get('/:id/runs', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const runs = await listRuns(db, experiment.id);
  return c.json({ items: await decorateRuns(db, runs, origin(c)) });
});

experimentRuns.get('/', async (c) => {
  const query = c.req.query();
  if (query.pending !== 'true') throw badRequest("query parameter 'pending' is required (pending=true)");
  const db = c.env.DB;
  const { limit, offset } = parsePagination(query);
  const rows = await listPendingRuns(db, limit, offset);
  return c.json({ items: rows.map(serializePendingRun) });
});

experimentRuns.get('/:runId', async (c) => {
  const db = c.env.DB;
  const run = await getRunOr404(db, c.req.param('runId'));
  const { decorated, experiment } = await getRunWithExperimentContext(db, run, origin(c));
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
  const updated = await updateExperimentRun(db, run, body);
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

// --- PairwiseJudgment ---

experiments.post('/:id/judgments', async (c) => {
  const body = createJudgmentSchema.parse(await c.req.json());
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const { row, winner, reveal } = await createJudgment(db, experiment, body);
  return c.json({ ...serializePairwiseJudgment(row, winner), reveal }, 201);
});

experiments.get('/:id/judgments', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  const items = await listJudgments(db, experiment.id);
  return c.json({ items: items.map(({ row, winner }) => serializePairwiseJudgment(row, winner)) });
});

experiments.get('/:id/judgments/summary', async (c) => {
  const db = c.env.DB;
  const experiment = await getExperimentOr404(db, c.req.param('id'));
  return c.json(await judgmentSummary(db, experiment));
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
