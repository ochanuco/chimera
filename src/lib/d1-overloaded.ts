// D1 は毎時 1〜2 分、負荷と関係なく 7429（overloaded）で全クエリを断ることがある。
// 500 と区別して 503 + Retry-After で返し、worker が待って再試行できるようにする（docs/api.md「Principles」）。

export const D1_OVERLOADED_RETRY_AFTER_SECONDS = 30;

export function isD1Overloaded(err: unknown): boolean {
  return err instanceof Error && err.message.includes('D1 DB is overloaded');
}
