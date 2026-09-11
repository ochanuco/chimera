// The recipes whose finalize takes `recolor`. recolor asserts the yukari
// lap-look palette; the worker refuses it on a yukari-sketch base, so the
// form does not offer it there.
const RECOLOR_RECIPES = new Set(['yukari']);

export function finalizeTakesRecolor(recipe: string | null): boolean {
  return recipe === null || RECOLOR_RECIPES.has(recipe);
}

export interface FinalizeDialWords {
  [word: string]: number;
}
export type FinalizeDials = Record<string, FinalizeDialWords>;

export interface FinalizeProfileOption {
  name: string;
  version: number;
  options: Record<string, unknown>;
}

/** Non-null, non-empty word map for `key`, or null when this recipe/catalog has no dial for it. */
export function dialWordsFor(dials: FinalizeDials | null | undefined, key: string): FinalizeDialWords | null {
  const words = dials?.[key];
  return words && Object.keys(words).length > 0 ? words : null;
}
