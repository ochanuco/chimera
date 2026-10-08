import { Layout } from '../layout';
import { CapActions } from '../components/CapActions';
import { REROLL_COUNT, type RerollState } from '../../lib/reroll';

export const ROUND_STATUS_HINT: Record<string, string> = { queued: '待機中', running: '処理中', failed: '失敗', cancelled: '中止' };

const SLOTS = Array.from({ length: REROLL_COUNT }, (_, i) => i);

/** `/reroll/:shortId`: the original on the left, one round of four seed-only re-runs on the right (a tab per round). The panes are drawn by the client from `data-initial`. */
export function RerollPage({ path, state }: { path: string; state: RerollState }) {
  const rerollable = state.recipe !== null;
  const latest = state.rounds[state.rounds.length - 1];
  const busy = latest !== undefined && (latest.request.status === 'queued' || latest.request.status === 'running');
  return (
    <Layout title={`リロール ${state.root.short_id}`} fullBleed path={path}>
      <div class="wb reroll" data-reroll data-root-id={state.root.id} data-root-short-id={state.root.short_id} data-initial={JSON.stringify(state)}>
        <div class="wb-head">
          <a class="wb-back" href={`/g/${state.root.short_id}`}>
            詳細へ戻る
          </a>
          <h1 class="style-check-title">
            リロール <span class="mono">{state.root.short_id}</span>
          </h1>
          {state.recipe ? <span class="work-source-recipe">{state.recipe}</span> : null}
        </div>

        <section class="wb-compare" aria-label="比較">
          <div class="wb-pills reroll-tabs" role="group" aria-label="回" data-rr-tabs hidden={state.rounds.length === 0}>
            {state.rounds.map((round, i) => (
              <button type="button" class={i === state.rounds.length - 1 ? 'wb-pill wb-pill-on' : 'wb-pill'} data-rr-round={String(i)}>
                {i + 1} 回目
                {ROUND_STATUS_HINT[round.request.status] ? <span class="wb-meta"> {ROUND_STATUS_HINT[round.request.status]}</span> : null}
              </button>
            ))}
          </div>
          <div class="reroll-board" data-rr-board>
            <figure class="wb-fig reroll-original">
              <figcaption class="wb-cap">
                <span>
                  元絵 <span class="wb-meta" data-rr-meta="input"></span>
                </span>
                <CapActions side="input" work />
              </figcaption>
              <div class="wb-pane" data-wb-input-pane></div>
            </figure>
            {SLOTS.map((i) => (
              <figure class="wb-fig">
                <figcaption class="wb-cap">
                  <span>
                    候補 {i + 1} <span class="wb-meta" data-rr-meta={String(i)}></span>
                  </span>
                  <CapActions side={`r${i}`} work />
                </figcaption>
                <div class="wb-pane" data-rr-pane={String(i)}></div>
              </figure>
            ))}
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
            <button type="button" class="wb-adopt" data-rr-run hidden={!rerollable} disabled={busy}>
              {busy ? '処理中…' : state.rounds.length > 0 ? `もう ${REROLL_COUNT} 枚振る` : `${REROLL_COUNT} 枚振る`}
            </button>
            {rerollable ? null : <p class="wb-note">この元絵は recipe 指定の generate から作られていないため、振り直せません。</p>}
            <p class="wb-error" data-rr-error role="alert" hidden></p>
          </div>
        </section>
      </div>
    </Layout>
  );
}
