export type BookmarkableTable = 'generations' | 'batches' | 'stories' | 'experiments';

/** Sets bookmark on a row by primary key `id`. Returns false if no row matched. */
export async function setBookmark(
  db: D1Database,
  table: BookmarkableTable,
  id: string,
  value: boolean,
): Promise<boolean> {
  const result = await db
    .prepare(`UPDATE ${table} SET bookmark = ? WHERE id = ?`)
    .bind(value ? 1 : 0, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
