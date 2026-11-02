import type { RequestRow } from '../types';

/** submitted は worker が graph を組み終え ComfyUI が受け取った状態 (Job に comfy_prompt_id がある)。pending は待ち時間内にどれにも至らなかった状態。 */
export type SettleOutcome = 'done' | 'failed' | 'cancelled' | 'submitted' | 'pending';

export interface Settled {
  row: RequestRow;
  settled: { outcome: SettleOutcome; waited_ms: number };
}

export const DEFAULT_ENQUEUE_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

/** MCP_ENQUEUE_WAIT_MS の解釈。未設定・不正値は既定、"0" は待たない。 */
export function enqueueWaitMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ENQUEUE_WAIT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_ENQUEUE_WAIT_MS;
}

async function observe(db: D1Database, id: string): Promise<{ row: RequestRow; outcome: SettleOutcome | null }> {
  const row = await db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestRow>();
  if (!row) throw new Error(`request ${id} vanished while waiting on it`);
  if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') {
    return { row, outcome: row.status };
  }
  const submitted = await db
    .prepare('SELECT 1 FROM comfy_jobs WHERE request_id = ? AND comfy_prompt_id IS NOT NULL LIMIT 1')
    .bind(id)
    .first();
  return { row, outcome: submitted ? 'submitted' : null };
}

/**
 * worker が失敗・完了するか、ComfyUI が graph を受け取るまで D1 を見て待つ。
 * patch の組み立て失敗は claim から 1 秒以内に failed になるので、呼び出し元は積んだ返事でそれを知る。
 * deliver などの仕上げ系は Job を完了後に記録するので、submitted を経ず done か pending で返る。
 */
export async function settleRequest(db: D1Database, row: RequestRow, timeoutMs: number): Promise<Settled> {
  const started = Date.now();
  for (;;) {
    const seen = await observe(db, row.id);
    const waited = Date.now() - started;
    if (seen.outcome) return { row: seen.row, settled: { outcome: seen.outcome, waited_ms: waited } };
    if (waited >= timeoutMs) return { row: seen.row, settled: { outcome: 'pending', waited_ms: waited } };
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, timeoutMs - waited)));
  }
}
