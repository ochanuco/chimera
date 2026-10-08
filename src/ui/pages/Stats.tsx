import { Layout } from '../layout';
import { STATS_PERIODS, SEGMENTS, type Stats, type StatsCold, type StatsPeriod } from '../../lib/stats';

const SEGMENT_LABEL: Record<(typeof SEGMENTS)[number], string> = {
  pre_submit: '投入前 (claim→submit)',
  queue: '待ち (submit→開始)',
  execute: '実行',
  post: '後処理 (終了→ingest)',
  tail: '残り (ingest→完了)',
};

export function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 120) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

const CHART_W = 640;
const CHART_H = 160;
const PAD = { l: 52, r: 12, t: 10, b: 22 };
const SERIES_COLOR: Record<string, string> = { v1: 'var(--text-dim)', v2: 'var(--accent)' };
const PALETTE = ['var(--accent)', 'var(--good)', 'var(--neutral)', 'var(--bad)', 'var(--graph-experiment)', 'var(--graph-relation)'];

interface Series {
  name: string;
  color: string;
  points: { x: number; y: number }[];
}

/** x は 0..xMax の値、y は ms。系列ごとの折れ線を素の SVG で描く。 */
function LineChart({ series, xMax, xLabels, label }: { series: Series[]; xMax: number; xLabels?: [string, string]; label: string }) {
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = Math.max(1, ...ys);
  const px = (x: number) => PAD.l + (xMax <= 0 ? 0 : (x / xMax) * (CHART_W - PAD.l - PAD.r));
  const py = (y: number) => CHART_H - PAD.b - (y / yMax) * (CHART_H - PAD.t - PAD.b);
  return (
    <svg class="stats-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={label}>
      <line x1={PAD.l} y1={py(0)} x2={CHART_W - PAD.r} y2={py(0)} class="stats-axis" />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={py(0)} class="stats-axis" />
      <text x={PAD.l - 6} y={PAD.t + 4} text-anchor="end" class="stats-tick">
        {formatMs(yMax)}
      </text>
      <text x={PAD.l - 6} y={py(0)} text-anchor="end" class="stats-tick">
        0
      </text>
      {xLabels ? (
        <>
          <text x={PAD.l} y={CHART_H - 6} class="stats-tick">
            {xLabels[0]}
          </text>
          <text x={CHART_W - PAD.r} y={CHART_H - 6} text-anchor="end" class="stats-tick">
            {xLabels[1]}
          </text>
        </>
      ) : null}
      {series.map((s) => (
        <g>
          {s.points.length > 1 ? (
            <polyline points={s.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} stroke-width="1.5" />
          ) : null}
          {s.points.map((p) => (
            <circle cx={px(p.x).toFixed(1)} cy={py(p.y).toFixed(1)} r="2.5" fill={s.color} />
          ))}
        </g>
      ))}
    </svg>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <p class="stats-legend">
      {items.map((i) => (
        <span>
          <i class="stats-swatch" style={`background:${i.color}`}></i>
          {i.name}
        </span>
      ))}
    </p>
  );
}

function DailyCharts({ daily }: { daily: Stats['daily'] }) {
  if (daily.length === 0) return <p class="empty-state">データなし</p>;
  const dates = Array.from(new Set(daily.map((d) => d.date))).sort();
  const index = new Map(dates.map((d, i) => [d, i]));
  const kinds = Array.from(new Set(daily.map((d) => d.kind))).sort();
  return (
    <>
      <Legend items={['v1', 'v2'].map((name) => ({ name, color: SERIES_COLOR[name]! }))} />
      {kinds.map((kind) => (
        <div class="stats-chart-block">
          <h3>{kind}</h3>
          <LineChart
            label={`${kind} 日別 median`}
            xMax={Math.max(1, dates.length - 1)}
            xLabels={[dates[0]!, dates[dates.length - 1]!]}
            series={(['v1', 'v2'] as const).map((version) => ({
              name: version,
              color: SERIES_COLOR[version]!,
              points: daily
                .filter((d) => d.kind === kind && d.version === version && d.median_ms !== null)
                .map((d) => ({ x: index.get(d.date)!, y: d.median_ms! })),
            }))}
          />
        </div>
      ))}
    </>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p class="empty-state">データなし</p>;
  return (
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th class={i === 0 ? '' : 'num'}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              {r.map((cell, i) => (
                <td class={i === 0 ? '' : 'num'}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statsHref(period: StatsPeriod, cold: StatsCold): string {
  return `/stats?period=${period}&cold=${cold}`;
}

export function StatsPage({ path, stats }: { path: string; stats: Stats }) {
  const { period, cold, counts } = stats;
  const r = counts.by_rating;
  const stepSeries: Series[] = stats.steps.map((s, i) => ({
    name: s.role,
    color: PALETTE[i % PALETTE.length]!,
    points: s.steps.filter((p) => p.median_ms !== null).map((p) => ({ x: p.index - 1, y: p.median_ms! })),
  }));
  const stepMax = Math.max(1, ...stats.steps.map((s) => s.steps.length - 1));
  return (
    <Layout title="統計" path={path}>
      <h1>生成時間の統計</h1>
      <p class="stats-controls">
        期間:{' '}
        {STATS_PERIODS.map((p) => (
          <a href={statsHref(p, cold)} aria-current={p === period ? 'true' : undefined}>
            {p === 'all' ? '全期間' : p}
          </a>
        ))}
        <span class="stats-sep"></span>
        cold load:{' '}
        {(['include', 'exclude'] as const).map((c) => (
          <a href={statsHref(period, c)} aria-current={c === cold ? 'true' : undefined}>
            {c === 'include' ? '含める' : '除く'}
          </a>
        ))}
      </p>

      <h2>件数</h2>
      <Table
        head={['項目', '値']}
        rows={[
          ['Generation', counts.generations],
          ['good / neutral / bad / 未評価', `${r.good} / ${r.neutral} / ${r.bad} / ${r.unrated}`],
          ['公開済み', counts.published],
          ['GPU 時間 (v2 + comfy_history の実行合計)', formatMs(counts.gpu_ms)],
          ['GPU 時間 概算 (requests のみ・claim→完了)', formatMs(counts.gpu_approx_ms)],
          ['所要時間の合計 (claim→完了)', formatMs(counts.wall_ms)],
          ['Generation あたり平均', formatMs(counts.mean_ms_per_generation)],
          ['good 1 枚あたり', formatMs(counts.ms_per_good_generation)],
        ]}
      />
      <div class="stats-cols">
        <div>
          <h3>kind</h3>
          <Table head={['kind', '件数']} rows={counts.by_kind.map((e) => [e.key, e.count])} />
        </div>
        <div>
          <h3>recipe</h3>
          <Table head={['recipe', '件数']} rows={counts.by_recipe.map((e) => [e.key, e.count])} />
        </div>
        <div>
          <h3>pose</h3>
          <Table head={['pose', '件数']} rows={counts.by_pose.map((e) => [e.key, e.count])} />
        </div>
      </div>

      <h2>kind 別の所要時間 (日別 median)</h2>
      <DailyCharts daily={stats.daily} />

      <h2>区間の内訳 (v2)</h2>
      <Table
        head={['kind', '区間', 'n', 'median', 'p90']}
        rows={stats.segments.map((s) => [s.kind, SEGMENT_LABEL[s.segment], s.n, formatMs(s.median_ms), formatMs(s.p90_ms)])}
      />

      <h2>ノード role 別の実行時間</h2>
      <Table
        head={['checkpoint', 'canvas', 'role', 'n', 'median', 'p90']}
        rows={stats.roles.map((s) => [s.checkpoint, s.canvas, s.role, s.n, formatMs(s.median_ms), formatMs(s.p90_ms)])}
      />

      <h2>サンプラーのステップ別時間</h2>
      {stats.steps.length === 0 ? (
        <p class="empty-state">データなし</p>
      ) : (
        <>
          <Legend items={stepSeries.map((s) => ({ name: s.name, color: s.color }))} />
          <LineChart label="step 別 median" series={stepSeries} xMax={stepMax} xLabels={['step 1', `step ${stepMax + 1}`]} />
          <Table
            head={['role', 'n', 'step 1 median', 'step 2..n median']}
            rows={stats.steps.map((s) => [s.role, s.n, formatMs(s.first_median_ms), formatMs(s.rest_median_ms)])}
          />
        </>
      )}

      <h2>環境別の実行時間 (v2)</h2>
      <Table
        head={['ComfyUI', 'attention', 'argv', 'kind', 'n', 'execute median']}
        rows={stats.environments.map((e) => [e.comfyui_version ?? '-', e.attention ?? '-', e.argv || '-', e.kind, e.n, formatMs(e.median_execute_ms)])}
      />
    </Layout>
  );
}
