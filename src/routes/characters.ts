import { Hono } from 'hono';
import { createCharacterSchema } from '../schemas/characters';
import { uuidv7 } from '../lib/uuidv7';
import { conflict } from '../lib/errors';
import type { AppEnv } from '../types';
import type { CharacterRow } from '../types';

export const characters = new Hono<AppEnv>();

function serialize(row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ? (JSON.parse(row.aliases) as string[]) : [],
  };
}

characters.post('/', async (c) => {
  const body = createCharacterSchema.parse(await c.req.json());
  const db = c.env.DB;

  const row: CharacterRow = {
    id: uuidv7(),
    name: body.name,
    aliases: body.aliases ? JSON.stringify(body.aliases) : null,
  };

  try {
    await db
      .prepare('INSERT INTO characters (id, name, aliases) VALUES (?, ?, ?)')
      .bind(row.id, row.name, row.aliases)
      .run();
  } catch (err) {
    // Check if this is a unique constraint violation on name
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw conflict(`character with name '${body.name}' already exists`);
    }
    throw err;
  }

  return c.json(serialize(row), 201);
});

characters.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM characters ORDER BY name').all<CharacterRow>();
  return c.json({ items: (results ?? []).map(serialize) });
});
