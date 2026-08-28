export interface MiniMapRow {
  label: string;
  items: { short_id: string; is_current: boolean }[];
}

/** A row with fewer than 2 items carries no lineage information. */
function visibleRows(rows: MiniMapRow[]): MiniMapRow[] {
  return rows.filter((r) => r.items.length >= 2);
}

/** Whether any row has enough items to render -- callers use this to decide whether to show the "Map" section at all. */
export function hasMiniMapContent(rows: MiniMapRow[]): boolean {
  return visibleRows(rows).length > 0;
}

/**
 * One-line, image-free lineage strip per relation chain / Story: `b_abc -- b_def -- [b_ghi] -- b_jkl`,
 * current position bracketed and unlinked. Deliberately lighter than FamilyStrip (no thumbnails) --
 * this is for skimming "where am I in the lineage", not for material/detail lookup.
 */
export function MiniMap({ rows }: { rows: MiniMapRow[] }) {
  return (
    <div class="mini-map">
      {visibleRows(rows).map((row) => (
        <div class="mini-map-row">
          <span class="mini-map-label">{row.label}</span>
          <span class="mini-map-chain">
            {row.items.map((item, i) => (
              <>
                {i > 0 ? <span class="mini-map-sep">--</span> : null}
                {item.is_current ? (
                  <span class="mini-map-current">[{item.short_id}]</span>
                ) : (
                  <a class="mini-map-item" href={`/b/${item.short_id}`}>
                    {item.short_id}
                  </a>
                )}
              </>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
