// zod を src/schemas/** に閉じ込めるための検査。差し替え時に書き換えるのは宣言だけで済む状態を保つ。
//   (a) src/schemas/ の外から zod を import しない
//   (b) src/schemas/ の外で、`...Schema` / `...Schemas` という名前の値のメンバ (.parse / ['shape'] など) に触れない
//       検証は lib/validate.ts の validate / parseOrThrow を通す
// 改行をまたぐ import やメソッドチェーンを取りこぼさず、コメントと文字列を誤検出しないよう、行ではなく構文木で見る。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const schemasDir = path.join(srcDir, 'schemas') + path.sep;

const SCHEMA_NAME = /Schemas?$/;

function listSources(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function isZodSpecifier(node) {
  return node !== undefined && ts.isStringLiteralLike(node) && (node.text === 'zod' || node.text.startsWith('zod/'));
}

/** `fooSchema` と `ns.fooSchema` を対象にする (後者は `mcpInputs.fooSchema.parse` のような参照)。 */
function schemaName(expr) {
  if (ts.isIdentifier(expr) && SCHEMA_NAME.test(expr.text)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && SCHEMA_NAME.test(expr.name.text)) return expr.name.text;
  return undefined;
}

function zodImportOf(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isZodSpecifier(node.moduleSpecifier)) return true;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return isZodSpecifier(node.moduleReference.expression);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
    return dynamic && isZodSpecifier(node.arguments[0]);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return isZodSpecifier(node.argument.literal);
  return false;
}

function schemaMemberOf(node) {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
  return schemaName(node.expression);
}

const violations = [];
for (const file of listSources(srcDir)) {
  if (file.startsWith(schemasDir)) continue;
  const rel = path.relative(root, file);
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const at = (node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const visit = (node) => {
    if (zodImportOf(node)) {
      violations.push(`${at(node)}: zod is imported outside src/schemas/: ${node.getText(sf).split('\n')[0]}`);
    }
    const member = schemaMemberOf(node);
    if (member) {
      violations.push(`${at(node)}: schema member access outside src/schemas/ (use validate / parseOrThrow): ${member}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  console.error(`\n${violations.length} zod boundary violation(s)`);
  process.exit(1);
}
console.log('zod boundary: ok');
