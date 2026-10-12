/** Photos uploaded on the `/photos` page: `import` Requests whose `parameters.kind` is `photo` (docs/ui.md「Photos」). */
export const PHOTO_PARAMETERS_KIND = 'photo';
export const PHOTOS_PAGE_SIZE = 60;
/** The longest side the `/photos` page shrinks an uploaded photo to before storing it as PNG. */
export const PHOTO_MAX_SIDE = 3072;

export interface PhotoItem {
  id: string;
  short_id: string;
  original_filename: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: string;
}

export async function listPhotos(db: D1Database, limit = PHOTOS_PAGE_SIZE): Promise<PhotoItem[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.short_id, g.original_filename, g.image_width, g.image_height, g.created_at
       FROM generations g JOIN requests r ON r.id = g.request_id
       WHERE r.kind = 'import' AND json_extract(r.parameters_json, '$.kind') = ?
       ORDER BY g.created_at DESC, g.id DESC LIMIT ?`,
    )
    .bind(PHOTO_PARAMETERS_KIND, limit)
    .all<PhotoItem>();
  return results ?? [];
}
