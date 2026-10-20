import { Layout } from '../layout';

export interface StyleCheckNode {
  id: string;
  short_id: string;
  seed: number | null;
  rating: 'bad' | 'neutral' | 'good' | null;
}

export interface StyleCheckRequest {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
}

export type StyleCheckDrift = 'match' | 'drift' | 'unknown' | 'no_pin';

export interface StyleCheckPromptDiff {
  column: string;
  baseline: string | null;
  arm: string | null;
  delta?: string;
}

export interface StyleCheckPoseView {
  pose: string;
  /** null: the pose has no pin, so it cannot be drawn. */
  pin: StyleCheckNode | null;
  drift: StyleCheckDrift;
  /** Only for drift: the pin's actual prompt (baseline) against the catalog pose's (arm). */
  prompt_diff: StyleCheckPromptDiff[];
  /** The plain render at the current render content, once enqueued. */
  request: StyleCheckRequest | null;
  /** Filled when the request is done and its Generation resolves. */
  result: StyleCheckNode | null;
}

export const DRIFT_LABELS: Record<StyleCheckDrift, string> = {
  match: '一致',
  drift: 'ドリフト',
  unknown: '判定不可',
  no_pin: 'pin なし',
};

export function StyleCheckPage({
  path,
  recipe,
  gitCommit,
  poses,
}: {
  path: string;
  recipe: string;
  gitCommit: string | null;
  poses: StyleCheckPoseView[];
}) {
  return (
    <Layout title="絵柄チェック" path={path}>
      <div class="style-check" data-style-check data-recipe={recipe} data-initial={JSON.stringify({ poses })}>
        <div class="style-check-head">
          <h1 class="style-check-title">絵柄チェック</h1>
          <button type="button" class="style-check-render-btn" data-style-check-render>
            pin 済みを全部描き直す
          </button>
        </div>
        <p class="image-meta">
          {recipe} · {poses.length} pose · 今のカタログ commit: <code>{gitCommit ?? '-'}</code>
        </p>

        <div class="sc-list">
          {poses.map((p) => (
            <article class="sc-row" data-sc-pose={p.pose}>
              <div class="sc-name">
                <span class="mono">{p.pose}</span>
                <span class={`sc-drift sc-drift-${p.drift}`} data-sc-drift>
                  {DRIFT_LABELS[p.drift]}
                </span>
              </div>
              <div class="sc-pin">
                {p.pin ? (
                  <a href={`/g/${p.pin.short_id}`}>
                    <img src={`/g/${p.pin.short_id}/preview`} alt={p.pin.short_id} loading="lazy" />
                    <span class="mono">
                      {p.pin.short_id} · seed {p.pin.seed ?? '-'}
                    </span>
                  </a>
                ) : (
                  <span class="sc-empty">pin なし</span>
                )}
              </div>
              <div class="sc-result" data-sc-result></div>
              <div class="sc-actions">
                <button type="button" class="wb-pill" data-sc-render-pose disabled={!p.pin}>
                  今のコードで描き直す
                </button>
              </div>
              {p.prompt_diff.length > 0 ? (
                <details class="sc-diff">
                  <summary>prompt の差 (pin → カタログ)</summary>
                  {p.prompt_diff.map((d) => (
                    <div>
                      <strong>{d.column}</strong>
                      {d.delta ? <pre>{d.delta}</pre> : null}
                      <details>
                        <summary>全文</summary>
                        <pre>pin: {d.baseline ?? '(none)'}</pre>
                        <pre>catalog: {d.arm ?? '(none)'}</pre>
                      </details>
                    </div>
                  ))}
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </Layout>
  );
}
