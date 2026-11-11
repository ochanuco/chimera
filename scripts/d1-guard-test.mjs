// d1-guard.mjs のテスト。Workers のランタイムでは子プロセスを起こせないので、vitest ではなく node --test で回す（pnpm run test:scripts）。
// PATH の先頭に偽の pnpm を置き、`pnpm exec wrangler d1 ...` の応答を FAKE_D1 の JSON（テーブル名 → 行数）から作る。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./d1-guard.mjs', import.meta.url));

const fakePnpm = `#!/usr/bin/env node
const { readFileSync } = require('node:fs');
const argv = process.argv.slice(2);
const db = JSON.parse(readFileSync(process.env.FAKE_D1, 'utf8'));
let results;
if (argv.includes('time-travel')) {
  console.log(JSON.stringify({ bookmark: 'bookmark-0001' }));
  process.exit(0);
}
const sql = argv[argv.indexOf('--command') + 1];
if (sql.includes("name = 'd1_migrations'")) results = [{ name: 'd1_migrations' }];
else if (sql.includes('FROM d1_migrations')) results = db.applied.map((name) => ({ name }));
else if (sql.includes('FROM sqlite_master')) results = Object.keys(db.tables).sort().map((name) => ({ name }));
else results = [Object.fromEntries([...sql.matchAll(/FROM "([^"]+)"/g)].map((m) => [m[1], db.tables[m[1]]]))];
console.log(JSON.stringify([{ results, success: true }]));
`;

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'd1-guard-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'bin', 'pnpm'), fakePnpm);
  chmodSync(join(dir, 'bin', 'pnpm'), 0o755);
  writeFileSync(join(dir, 'migrations', '0001_init.sql'), 'CREATE TABLE a (id INTEGER);\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setDb(tables, applied = ['0001_init.sql']) {
  writeFileSync(join(dir, 'd1.json'), JSON.stringify({ tables, applied }));
}

function run(...args) {
  const env = { ...process.env, PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`, FAKE_D1: join(dir, 'd1.json') };
  delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(process.execPath, [guard, ...args], { encoding: 'utf8', env });
}

// before → （migration を当てたつもりで DB を差し替える）→ after
function guardAround({ before, migration, after }) {
  const state = join(dir, 'state.json');
  setDb(before);
  if (migration !== undefined) writeFileSync(join(dir, 'migrations', '0002_change.sql'), migration);
  const b = run('before', '--driver', 'wrangler', '--db', 'testdb', '--dir', join(dir, 'migrations'), '--state', state);
  assert.equal(b.status, 0, b.stderr);
  setDb(after, ['0001_init.sql', '0002_change.sql']);
  return run('after', '--state', state);
}

test('行の入ったテーブルを DROP する migration で止まる', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, migration: 'DROP TABLE b;\n', after: { a: 3 } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\| ⚠️ b（消えた） \| 2 \| - \|/);
  assert.match(r.stdout, /行が減った（消えたテーブルを含む）: b。Worker は出さずに止める。/);
  assert.match(r.stdout, /time-travel restore testdb --bookmark=bookmark-0001/);
});

test('改名（元の名前が消える）も、行が入っていれば止まる', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, migration: 'ALTER TABLE b RENAME TO c;\n', after: { a: 3, c: 2 } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\| ⚠️ b（消えた） \| 2 \| - \|/);
});

test('空のテーブルの DROP は通る', () => {
  const r = guardAround({ before: { a: 3, b: 0 }, migration: 'DROP TABLE b;\n', after: { a: 3 } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\| b（消えた） \| 0 \| - \|/);
  assert.doesNotMatch(r.stdout, /⚠️/);
});

test('allow-row-loss を書いた DROP は通る', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, migration: '-- deploy: allow-row-loss b\nDROP TABLE b;\n', after: { a: 3 } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\| b（消えた） \| 2 \| - \|/);
  assert.doesNotMatch(r.stdout, /⚠️/);
});

test('allow-row-loss は書いたテーブルにだけ効く', () => {
  const r = guardAround({ before: { a: 3, b: 2, c: 1 }, migration: '-- deploy: allow-row-loss b\nDROP TABLE b;\nDROP TABLE c;\n', after: { a: 3 } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /行が減った（消えたテーブルを含む）: c。/);
});

test('行が減ったテーブルがあれば止まる', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, migration: 'DELETE FROM a;\n', after: { a: 1, b: 2 } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\| ⚠️ a \| 3 \| 1 \|/);
});

test('allow-row-loss を書いた行の減少は通る', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, migration: '-- deploy: allow-row-loss a\nDELETE FROM a;\n', after: { a: 1, b: 2 } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\| a \| 3 \| 1 \|/);
});

test('行が増えただけ、テーブルが増えただけなら通る', () => {
  const r = guardAround({ before: { a: 3 }, migration: 'CREATE TABLE b (id INTEGER);\n', after: { a: 4, b: 0 } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /\| a \| 3 \| 4 \|/);
});

test('変化が無ければ通る', () => {
  const r = guardAround({ before: { a: 3 }, migration: 'CREATE INDEX a_id ON a (id);\n', after: { a: 3 } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /行数の変わったテーブルは無い。/);
});

test('未適用の migration が無ければ、テーブルが消えていても何も見ない', () => {
  const r = guardAround({ before: { a: 3, b: 2 }, after: { a: 3 } });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).pending.length, 0);
});
