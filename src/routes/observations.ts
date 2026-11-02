import { Hono } from 'hono';
import { createObservationSchema } from '../schemas/observations';
import { createObservation, listObservations, getObservation } from '../lib/observations';
import { parsePagination } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { parseOrThrow } from '../lib/validate';
import type { AppEnv, ObservationOutcome } from '../types';

export const observations = new Hono<AppEnv>();

const OUTCOMES: readonly ObservationOutcome[] = ['accepted', 'rejected', 'inconclusive'];

function parseOutcome(raw: string | undefined): ObservationOutcome | undefined {
  if (!raw) return undefined;
  if (!(OUTCOMES as readonly string[]).includes(raw)) throw badRequest(`invalid outcome '${raw}'`);
  return raw as ObservationOutcome;
}

observations.post('/', async (c) => {
  const body = parseOrThrow(createObservationSchema, await c.req.json());
  const row = await createObservation(c.env.DB, body, 'gui');
  return c.json(row, 201);
});

observations.get('/', async (c) => {
  const query = c.req.query();
  const { items, total } = await listObservations(
    c.env.DB,
    {
      character: query.character,
      pose: query.pose,
      component: query.component,
      parameter: query.parameter,
      outcome: parseOutcome(query.outcome),
      q: query.q,
    },
    parsePagination(query),
  );
  return c.json({ items, total });
});

observations.get('/:id', async (c) => {
  const row = await getObservation(c.env.DB, c.req.param('id'));
  if (!row) throw notFound('observation');
  return c.json(row);
});
