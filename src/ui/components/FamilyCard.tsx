export type RelKind = 'reference' | 'refinement' | 'story';

/** Small rounded label distinguishing which of the three Relation types (see CLAUDE.md invariants) a card comes from. */
export function RelBadge({ kind }: { kind: RelKind }) {
  const label = kind === 'reference' ? 'Reference' : kind === 'refinement' ? 'Refinement' : 'Story';
  return <span class={`rel-badge rel-${kind}`}>{label}</span>;
}

export interface FamilyCardData {
  kind: RelKind;
  href: string;
  shortId: string;
  /** Generation image URL, or null for an empty placeholder (e.g. a Batch with no Generations yet). */
  imageUrl: string | null;
  /** Marks a card as describing a relation of the owning Batch rather than of the Generation itself (e.g. "via batch"). */
  caption?: string | null;
  /** purpose/aspect, reason, or Story name/label text. */
  detail?: string | null;
}

/** Thumbnail card for a 親/子/兄弟 family relation: links straight to the related Generation/Batch detail page. */
export function FamilyCard({ item }: { item: FamilyCardData }) {
  return (
    <a class="family-card" href={item.href}>
      <div class="family-card-thumb">
        {item.imageUrl ? <img src={item.imageUrl} alt={item.shortId} loading="lazy" /> : <div class="family-card-thumb-empty" />}
      </div>
      <div class="family-card-body">
        <div class="family-card-top">
          <RelBadge kind={item.kind} />
          {item.caption ? <span class="family-card-caption">{item.caption}</span> : null}
        </div>
        <span class="family-card-id">{item.shortId}</span>
        {item.detail ? <span class="family-card-detail">{item.detail}</span> : null}
      </div>
    </a>
  );
}

/** Horizontal wrapping strip of FamilyCards for a 親/子/兄弟 section body; falls back to plain text when empty. */
export function FamilyStrip({ items, emptyText = 'None.' }: { items: FamilyCardData[]; emptyText?: string }) {
  if (items.length === 0) return <p>{emptyText}</p>;
  return (
    <div class="family-strip">
      {items.map((item) => (
        <FamilyCard item={item} />
      ))}
    </div>
  );
}
