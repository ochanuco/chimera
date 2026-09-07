// The recipes whose finalize takes `recolor`. recolor asserts the yukari
// lap-look palette; the worker refuses it on a yukari-sketch base, so the
// form does not offer it there.
const RECOLOR_RECIPES = new Set(['yukari']);

export function finalizeTakesRecolor(recipe: string | null): boolean {
  return recipe === null || RECOLOR_RECIPES.has(recipe);
}
