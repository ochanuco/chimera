import { Layout } from '../layout';

/** The slice of a Generation the compare panes and captions need; matches a workbench node where they overlap. */
export interface StyleCheckNode {
  id: string;
  short_id: string;
  rating: 'bad' | 'neutral' | 'good' | null;
  delivered: false;
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
}

export interface StyleCheckRequest {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  error: string | null;
}

export interface StyleCheckPoseView {
  framing: string;
  pose: string;
  /** null: the pose has no pin, so it cannot be drawn. */
  pin: StyleCheckNode | null;
  /** The plain render at the current render content, once enqueued. */
  request: StyleCheckRequest | null;
  /** Filled when the request is done and its Generation resolves. */
  result: StyleCheckNode | null;
}

export function styleCheckHint(p: Pick<StyleCheckPoseView, 'pin' | 'request' | 'result'>): string {
  if (!p.pin) return 'pin 無し';
  if (!p.request) return '未描画';
  if (p.request.status === 'done' && !p.result) return 'done';
  return p.request.status;
}

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
    <Layout title="絵柄チェック" fullBleed path={path}>
      <div class="wb style-check" data-style-check data-recipe={recipe} data-initial={JSON.stringify({ poses })}>
        <div class="wb-head">
          <h1 class="style-check-title">絵柄チェック</h1>
          <nav class="wb-steps-nav" aria-label="ポーズ">
            <ol class="wb-steps">
              {poses.map((p, i) => (
                <li>
                  {i > 0 ? (
                    <span class="wb-step-sep" aria-hidden="true">
                      ›
                    </span>
                  ) : null}
                  <button type="button" class="wb-step" data-sc-pose={p.pose}>
                    <span class="wb-step-label">
                      {p.framing} ({p.pose})
                    </span>
                    <span class="wb-step-kind mono" data-sc-hint>
                      {styleCheckHint(p)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <button type="button" class="style-check-render-btn" data-style-check-render data-recipe={recipe}>
            今の既定で描く
          </button>
        </div>
        <p class="image-meta">
          {recipe} · 今のカタログ commit: <code>{gitCommit ?? '-'}</code>
        </p>

        <div class="wb-main">
          <section class="wb-compare" aria-label="比較">
            <div class="wb-pair" data-wb-pair>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span data-sc-left-cap></span>
                  <button type="button" class="wb-pill" data-sc-left-reset hidden>
                    pin に戻す
                  </button>
                </figcaption>
                <div class="wb-pane" data-wb-input-pane></div>
              </figure>
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span data-sc-right-cap></span>
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
              <button type="button" class="wb-pill" data-sc-replace-pin>
                pin を差し替える
              </button>
              <form class="style-check-any-id" data-sc-any-id>
                <input type="text" name="id" placeholder="short_id" aria-label="左に出す ID" autocomplete="off" />
                <button type="submit" class="wb-pill">
                  任意 ID と比較
                </button>
              </form>
              <a class="wb-pill" data-sc-compare-link hidden>
                /compare で開く
              </a>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
