// zod を src/schemas/** に閉じ込めるための検査。差し替え時に書き換えるのは宣言だけで済む状態を保つ。
//   (a) src/schemas/ の外から zod を import しない
//   (b) src/schemas/ の外で、`...Schema` / `...Schemas` という識別子のメンバ (.parse / .shape / .extend など) に触れない
//       検証は lib/validate.ts の validate / parseOrThrow を通す
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const schemasDir = path.join(srcDir, 'schemas') + path.sep;

const ZOD_IMPORT = /\b(?:from|import|require)\s*\(?\s*['"]zod[^'"]*['"]/;
const SCHEMA_MEMBER = /\b\w*Schemas?\s*\??\.\s*\w+/;

function listSources(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** コメントを空白に置き換える (改行は残す)。文字列の中の `//` はコメントとして扱わない。 */
function blankComments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i += 1;
    }
  }
  return out;
}

const violations = [];
for (const file of listSources(srcDir)) {
  if (file.startsWith(schemasDir)) continue;
  const rel = path.relative(root, file);
  const raw = fs.readFileSync(file, 'utf8').split('\n');
  const code = blankComments(fs.readFileSync(file, 'utf8')).split('\n');
  code.forEach((line, i) => {
    if (ZOD_IMPORT.test(line)) violations.push(`${rel}:${i + 1}: zod is imported outside src/schemas/: ${raw[i].trim()}`);
    const member = SCHEMA_MEMBER.exec(line);
    if (member) violations.push(`${rel}:${i + 1}: schema member access outside src/schemas/ (use validate / parseOrThrow): ${member[0]}`);
  });
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`\n${violations.length} zod boundary violation(s)`);
  process.exit(1);
}
console.log('zod boundary: ok');
