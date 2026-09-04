import { raw } from 'hono/html';
import { Layout } from '../layout';

export interface AbPairSide {
  id: string;
  image_url: string;
}

export interface AbPair {
  seed: number;
  left: AbPairSide;
  right: AbPairSide;
}

export interface ExperimentAbData {
  experiment: { id: string; short_id: string; name: string };
  baseline_run_id: string | null;
  arm_run_id: string | null;
  baseline_run_index: number | null;
  arm_run_index: number | null;
  warning: string | null;
  pairs: AbPair[];
  judged_count: number;
  total_seeds: number;
}

/** `<` を `\u003c` に潰すのは JSON 内に `</script>` が紛れ込んでもタグとして解釈させないための保険。 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function ExperimentAbPage({ data }: { data: ExperimentAbData }) {
  const { experiment, warning, pairs, judged_count, total_seeds, baseline_run_id, arm_run_id, baseline_run_index, arm_run_index } =
    data;

  return (
    <Layout title={`A/B - ${experiment.name}`} fullBleed>
      <h1>
        <a href={`/experiments/${experiment.short_id}`}>{experiment.name}</a>
      </h1>

      {warning ? (
        <p class="ab-warning">{warning}</p>
      ) : (
        <>
          <p class="ab-subtitle">
            A/B blind: run #{baseline_run_index} vs #{arm_run_index}
          </p>
          <p>
            <span class="ab-progress">
              {judged_count} / {total_seeds}
            </span>
          </p>

          <div
            class="ab-root"
            data-experiment-id={experiment.id}
            data-baseline-run-id={baseline_run_id}
            data-arm-run-id={arm_run_id}
            data-judged={judged_count}
            data-total={total_seeds}
          >
            <script type="application/json" id="ab-pairs">
              {raw(embedJson(pairs))}
            </script>

            <p class="ab-done" hidden={pairs.length > 0}>
              All seeds judged. <a href={`/experiments/${experiment.short_id}`}>Back to experiment</a>
            </p>

            <div class="ab-pair-area" hidden={pairs.length === 0}>
              <p class="ab-seed">
                Seed <span class="ab-seed-value"></span>
              </p>
              <div class="ab-pair">
                <a class="ab-side" data-side="left" target="_blank" rel="noopener">
                  <span class="ab-side-label">A</span>
                  <img alt="A" />
                </a>
                <a class="ab-side" data-side="right" target="_blank" rel="noopener">
                  <span class="ab-side-label">B</span>
                  <img alt="B" />
                </a>
              </div>
              <div class="ab-votes">
                <button type="button" class="ab-vote" data-verdict="left">
                  A
                </button>
                <button type="button" class="ab-vote" data-verdict="tie">
                  Tie
                </button>
                <button type="button" class="ab-vote" data-verdict="right">
                  B
                </button>
              </div>
              <p class="ab-hint">Keys: 1 / ← = A, 2 / → = B, 0 / T = Tie</p>
              <div class="ab-reveal" hidden>
                <p class="ab-reveal-line"></p>
                <button type="button" class="ab-next">
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
