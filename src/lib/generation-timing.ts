// Generation Detail の「描画」行 (docs/ui.md「Generation Detail」)。公開 API の get_generation には載せない。
// requests の時刻は ISO 文字列、prompt_timings の時刻は worker 機の epoch ミリ秒で、単位が違う。

export interface GenerationTiming {
  /** この Generation の ComfyUI Job の実行時間。計測行が無ければ Request の claimed → finished。 */
  renderMs: number;
  /** Request が積まれてから worker が取るまで。 */
  waitMs: number | null;
}

interface TimingRow {
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  status: string;
  render_ms: number | null;
}

function isoDiff(end: string | null, start: string | null): number | null {
  if (!end || !start) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isNaN(ms) || ms < 0 ? null : ms;
}

/** null は描画時間が分からない（import や計測前の Request）。行ごと出さない。 */
export async function loadGenerationTiming(db: D1Database, comfyJobId: string): Promise<GenerationTiming | null> {
  // 同じ Job に試行や v1 / v2 の行が重なることがあるので、両方の時刻がそろう最後の 1 行を採る。
  const row = await db
    .prepare(
      `SELECT r.created_at, r.claimed_at, r.finished_at, r.status,
              (SELECT p.execution_end_at - p.execution_start_at FROM prompt_timings p
                WHERE p.request_id = r.id AND p.comfy_job_id = j.id
                  AND p.execution_start_at IS NOT NULL AND p.execution_end_at IS NOT NULL
                  AND p.execution_end_at >= p.execution_start_at
                ORDER BY p.execution_end_at DESC LIMIT 1) AS render_ms
         FROM comfy_jobs j JOIN requests r ON r.id = j.request_id
        WHERE j.id = ?`,
    )
    .bind(comfyJobId)
    .first<TimingRow>();
  if (!row) return null;
  const finished = row.status === 'done' || row.status === 'failed';
  const renderMs = row.render_ms ?? (finished ? isoDiff(row.finished_at, row.claimed_at) : null);
  if (renderMs === null) return null;
  return { renderMs, waitMs: isoDiff(row.claimed_at, row.created_at) };
}

/** `42 秒` / `3 分 12 秒` / `1 時間 5 分`。1 秒未満は `1 秒未満`。 */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return '1 秒未満';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h} 時間 ${m} 分` : `${h} 時間`;
  if (m > 0) return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
  return `${s} 秒`;
}

/** `MM/DD HH:mm`（JST）。Workers は UTC で動くので +9 時間ずらして UTC として読む。 */
export function formatJstMinute(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
