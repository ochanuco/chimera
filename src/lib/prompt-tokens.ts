/** Pure tokenizer/diff for SD-style prompt strings (Batch detail Prompt chip display). Never throws -- unparsable input falls back to a single plain tag token. */

export interface PromptToken {
  text: string;
  weight: number;
  kind: 'tag' | 'lora' | 'break';
}

const LORA_RE = /^<lora:([^:>]+)(?::([\d.]+))?>$/i;
const TRAILING_WEIGHT_RE = /^(.*):([\d.]+)$/;

function roundWeight(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Strips matching outer ()/[] layers, tracking how many of each so a weight can be derived when none is given explicitly. */
function stripBrackets(text: string): { inner: string; parenDepth: number; bracketDepth: number } {
  let inner = text;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (;;) {
    if (inner.length >= 2 && inner[0] === '(' && inner[inner.length - 1] === ')') {
      inner = inner.slice(1, -1).trim();
      parenDepth += 1;
      continue;
    }
    if (inner.length >= 2 && inner[0] === '[' && inner[inner.length - 1] === ']') {
      inner = inner.slice(1, -1).trim();
      bracketDepth += 1;
      continue;
    }
    break;
  }
  return { inner, parenDepth, bracketDepth };
}

function parseSegment(raw: string): PromptToken {
  const trimmed = raw.trim();

  const loraMatch = LORA_RE.exec(trimmed);
  if (loraMatch) {
    const name = loraMatch[1]!;
    const weightRaw = loraMatch[2];
    const weight = weightRaw !== undefined && !Number.isNaN(Number(weightRaw)) ? Number(weightRaw) : 1;
    return { text: `lora:${name}`, weight, kind: 'lora' };
  }

  if (trimmed === 'BREAK') {
    return { text: trimmed, weight: 1, kind: 'break' };
  }

  const { inner, parenDepth, bracketDepth } = stripBrackets(trimmed);

  const trailingWeightMatch = (parenDepth > 0 || bracketDepth > 0) ? TRAILING_WEIGHT_RE.exec(inner) : null;
  if (trailingWeightMatch && !Number.isNaN(Number(trailingWeightMatch[2]))) {
    return { text: trailingWeightMatch[1]!.trim(), weight: Number(trailingWeightMatch[2]), kind: 'tag' };
  }

  if (parenDepth > 0 || bracketDepth > 0) {
    const weight = roundWeight(1.1 ** parenDepth * 0.9 ** bracketDepth);
    return { text: inner, weight, kind: 'tag' };
  }

  return { text: trimmed, weight: 1, kind: 'tag' };
}

export function tokenizePrompt(text: string): PromptToken[] {
  if (!text) return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      try {
        return parseSegment(s);
      } catch {
        return { text: s, weight: 1, kind: 'tag' as const };
      }
    });
}

function diffKey(t: PromptToken): string {
  return `${t.kind}:${t.text}`;
}

export interface DiffedPromptToken extends PromptToken {
  diff?: 'added' | 'weight';
  parentWeight?: number;
}

export function diffTokens(
  current: PromptToken[],
  parent: PromptToken[],
): { tokens: DiffedPromptToken[]; removed: PromptToken[] } {
  const parentByKey = new Map<string, PromptToken>();
  for (const t of parent) {
    if (!parentByKey.has(diffKey(t))) parentByKey.set(diffKey(t), t);
  }
  const currentKeys = new Set(current.map(diffKey));

  const tokens: DiffedPromptToken[] = current.map((t) => {
    const key = diffKey(t);
    const parentToken = parentByKey.get(key);
    if (!parentToken) {
      return { ...t, diff: 'added' };
    }
    if (parentToken.weight !== t.weight) {
      return { ...t, diff: 'weight', parentWeight: parentToken.weight };
    }
    return { ...t };
  });

  const removed = parent.filter((t) => !currentKeys.has(diffKey(t)));

  return { tokens, removed };
}
