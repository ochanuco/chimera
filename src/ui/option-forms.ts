export interface DialWords {
  [word: string]: number;
}
export type Dials = Record<string, DialWords>;

export interface DeliverProfileOption {
  name: string;
  version: number;
  options: Record<string, unknown>;
}

/** Non-null, non-empty word map for `key`, or null when this recipe/catalog has no dial for it. */
export function dialWordsFor(dials: Dials | null | undefined, key: string): DialWords | null {
  const words = dials?.[key];
  return words && Object.keys(words).length > 0 ? words : null;
}
