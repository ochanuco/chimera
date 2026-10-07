// Gallery の時系列枠 (docs/ui.md「Gallery」タイムライン)。枠は JST (UTC+9) の 15 分単位で、キーは `2026-10-06T21:45` (JST の壁時計)。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SLOT_MS = 15 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const SLOT_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/;

/** created_at (UTC ISO) が属する枠のキー。解釈できなければ null。 */
export function slotKeyOf(createdAt: string): string | null {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return null;
  return new Date(Math.floor((ms + JST_OFFSET_MS) / SLOT_MS) * SLOT_MS).toISOString().slice(0, 16);
}

/** 枠の終端 (UTC ISO)。この時刻より前の Generation がその枠以前の一覧になる。キーが不正なら null。 */
export function slotEndIso(slot: string): string | null {
  if (!SLOT_KEY.test(slot)) return null;
  const startMs = Date.parse(`${slot}:00.000Z`);
  if (Number.isNaN(startMs)) return null;
  return new Date(startMs - JST_OFFSET_MS + SLOT_MS).toISOString();
}

/** `10月6日（火）` */
export function dateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

/** `21:45–22:00` */
export function slotRangeLabel(slot: string): string {
  const start = slot.slice(11, 16);
  const endMs = Date.parse(`${slot}:00.000Z`) + SLOT_MS;
  return `${start}–${new Date(endMs).toISOString().slice(11, 16)}`;
}
