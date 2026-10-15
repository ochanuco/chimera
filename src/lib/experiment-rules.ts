/** create_experiment の parameters と seeds を、Experiment に保存する base_parameters にまとめる。 */
export function mergedBaseParameters(input: { parameters?: Record<string, unknown>; seeds?: number[] }): Record<string, unknown> {
  return { ...(input.parameters ?? {}), ...(input.seeds ? { seeds: input.seeds } : {}) };
}
