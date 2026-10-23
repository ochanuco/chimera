import { Layout } from '../layout';
import { GenerationCard, GenerationCardTemplate } from '../components/GenerationCard';

export interface StyleCheckNode {
  id: string;
  short_id: string;
  seed: number | null;
  rating: 'bad' | 'neutral' | 'good' | null;
  bookmark: boolean;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
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
  /** Sweep mode only: the pose is not part of the sweep. */
  excluded: boolean;
}

export interface StyleCheckSweep {
  short_id: string;
  name: string;
  patches: unknown[];
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
  selectedPose,
  sweep,
}: {
  path: string;
  recipe: string;
  gitCommit: string | null;
  poses: StyleCheckPoseView[];
  /** `?pose=`: the pose whose compare viewer is open. */
  selectedPose: string | null;
  /** `?sweep=`: show that pose sweep's results on the right instead of the latest plain render. */
  sweep: StyleCheckSweep | null;
}) {
  const selected = poses.find((p) => p.pose === selectedPose) ?? null;
  return (
    <Layout title="絵柄チェック" path={path}>
      <GenerationCardTemplate />
      <div class="style-check" data-style-check data-recipe={recipe} data-initial={JSON.stringify({ poses, sweep })}>
        <div class="style-check-head">
          <h1 class="style-check-title">絵柄チェック</h1>
          {sweep ? null : (
            <button type="button" class="style-check-render-btn" data-style-check-render>
              pin 済みを全部描き直す
            </button>
          )}
        </div>
        {sweep ? (
          <section class="sc-sweep" data-sc-sweep>
            <p>
              sweep: <strong>{sweep.name}</strong> · <a href={`/experiments/${sweep.short_id}`}>実験ページ</a> ·{' '}
              <a href="/check">通常の一覧に戻る</a>
            </p>
            <details>
              <summary>patches ({sweep.patches.length})</summary>
              <pre>{JSON.stringify(sweep.patches, null, 2)}</pre>
            </details>
          </section>
        ) : null}
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
                  <GenerationCard g={p.pin} compact>
                    seed {p.pin.seed ?? '-'}
                  </GenerationCard>
                ) : (
                  <span class="sc-empty">pin なし</span>
                )}
              </div>
              <div class="sc-result" data-sc-result></div>
              <div class="sc-actions">
                {sweep ? null : (
                  <button type="button" class="wb-pill" data-sc-render-pose disabled={!p.pin}>
                    今のコードで描き直す
                  </button>
                )}
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

        <div class="sc-viewer wb" data-sc-viewer hidden={!selected}>
          <div class="wb-head">
            <button type="button" class="wb-pill" data-scv-close title="Esc">
              一覧に戻る
            </button>
            <button type="button" class="wb-pill" data-scv-step="-1" title="← / k">
              ‹ 前
            </button>
            <button type="button" class="wb-pill" data-scv-step="1" title="→ / j">
              次 ›
            </button>
            <span class="mono" data-scv-name>
              {selected?.pose}
            </span>
            <span class={`sc-drift sc-drift-${selected?.drift ?? 'unknown'}`} data-scv-drift>
              {selected ? DRIFT_LABELS[selected.drift] : ''}
            </span>
            <span class="sc-viewer-actions">
              <button type="button" class="wb-pill" data-scv-render hidden={sweep !== null}>
                今のコードで描き直す
              </button>
              <button type="button" class="wb-pill" data-scv-adopt hidden={sweep !== null}>
                good にして基準にする
              </button>
              <a class="wb-pill" data-scv-compare-link hidden>
                /compare で開く
              </a>
            </span>
          </div>
          <section class="wb-compare" aria-label="比較">
            <div class="wb-pair" data-wb-pair>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span data-scv-left-cap></span>
                </figcaption>
                <div class="wb-pane" data-wb-input-pane></div>
              </figure>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span data-scv-right-cap></span>
                  <div class="rating-group wb-rating" data-wb-rating role="group" aria-label="評価" hidden>
                    {(['bad', 'neutral', 'good'] as const).map((r) => (
                      <button type="button" class="rate-btn" data-rating={r}>
                        {r}
                      </button>
                    ))}
                  </div>
                </figcaption>
                <div class="wb-pane" data-wb-cmp-pane></div>
              </figure>
            </div>
            <div class="wb-controls">
              <div class="wb-pills" role="group" aria-label="ルーペ">
                <button type="button" class="wb-pill wb-pill-on" data-wb-loupe-toggle title="z で切り替え">
                  ルーペ
                </button>
                {[2, 3, 5, 8].map((z) => (
                  <button type="button" class="wb-pill" data-wb-loupe-zoom={String(z)} title="[ ] で倍率">
                    ×{z}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
