import { tokenizePrompt, diffTokens, type PromptToken, type DiffedPromptToken } from '../../lib/prompt-tokens';

const RAW_FALLBACK_LENGTH = 80;

function formatWeight(w: number): string {
  return String(w);
}

function chipLabel(t: PromptToken): string {
  return t.text;
}

function weightBadge(t: DiffedPromptToken) {
  if (t.diff === 'weight' && t.parentWeight !== undefined) {
    return <span class="w-badge">{`${formatWeight(t.parentWeight)}→${formatWeight(t.weight)}`}</span>;
  }
  if (t.weight === 1) return null;
  return <span class={`w-badge ${t.weight > 1 ? 'w-up' : 'w-down'}`}>{formatWeight(t.weight)}</span>;
}

function chipClass(t: DiffedPromptToken): string {
  const classes = ['prompt-chip'];
  if (t.kind === 'lora') classes.push('chip-lora');
  if (t.kind === 'break') classes.push('chip-break');
  if (t.diff === 'added') classes.push('diff-added');
  if (t.diff === 'weight') classes.push('diff-weight');
  return classes.join(' ');
}

/** Renders prompt / negative_prompt as chip tokens, with an optional diff against a retry parent's prompt text. */
export function PromptChips({
  text,
  parentText,
  variant = 'positive',
}: {
  text: string | null;
  parentText?: string | null;
  variant?: 'positive' | 'negative';
}) {
  if (!text) return <span>-</span>;

  const tokens = tokenizePrompt(text);

  // カンマなしの自然文（単一トークンかつ長文）はチップ化せず素のテキストで表示する。diffもスキップ。
  if (tokens.length <= 1 && text.length > RAW_FALLBACK_LENGTH) {
    return <p class="prompt-raw">{text}</p>;
  }

  const parentTokens = parentText ? tokenizePrompt(parentText) : null;
  const { tokens: diffedTokens, removed } = parentTokens
    ? diffTokens(tokens, parentTokens)
    : { tokens: tokens as DiffedPromptToken[], removed: [] as PromptToken[] };

  return (
    <>
      <div class={`prompt-chips${variant === 'negative' ? ' negative' : ''}`}>
        {diffedTokens.map((t) => (
          <span class={chipClass(t)}>
            {chipLabel(t)}
            {weightBadge(t)}
          </span>
        ))}
      </div>
      {removed.length > 0 ? (
        <div class="prompt-removed">
          {removed.map((t) => (
            <span class={`prompt-chip diff-removed${t.kind === 'lora' ? ' chip-lora' : ''}${t.kind === 'break' ? ' chip-break' : ''}`}>
              {chipLabel(t)}
              {t.weight !== 1 ? <span class={`w-badge ${t.weight > 1 ? 'w-up' : 'w-down'}`}>{formatWeight(t.weight)}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
