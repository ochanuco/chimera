// ChatGPT の MCP client は tool 結果をコンテンツ分類器にかけ、prompt 本文のタグ (「thick
// thighs」等) に一度でも引っかかるとそのセッションでコネクタごと無効化する。MCP の読み取り
// tool はデフォルトで prompt 本文を長さマーカーに畳み、include_prompts: true でのみ実体を返す。

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replaces a prompt body with a marker that keeps only its length. */
export function foldPromptText(text: string): string {
  return `[prompt body folded, ${text.length} chars; pass include_prompts: true to read it]`;
}

/** Folds only non-empty strings; null/undefined/non-string values pass through untouched. */
function foldIfString(value: unknown): unknown {
  return typeof value === 'string' && value.length > 0 ? foldPromptText(value) : value;
}

/** Patches whose `target` starts with "prompt." carry prompt text in `old`/`value`; every other patch passes through unchanged. */
function foldPatchArray(patches: unknown): unknown {
  if (!Array.isArray(patches)) return patches;
  return patches.map((patch) => {
    if (!isRecord(patch) || typeof patch.target !== 'string' || !patch.target.startsWith('prompt.')) return patch;
    const folded: Record<string, unknown> = { ...patch };
    if ('old' in patch) folded.old = foldIfString(patch.old);
    if ('value' in patch) folded.value = foldIfString(patch.value);
    return folded;
  });
}

/** request.json payload (docs/generation-request.md) / finalize / repair / masked_redraw payload with prompt bodies folded. Never mutates the input. */
export function foldRequestPayloadPrompts(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const result: Record<string, unknown> = { ...payload };

  if (isRecord(payload.generation)) {
    result.generation = {
      ...payload.generation,
      prompt: foldIfString(payload.generation.prompt),
      negative_prompt: foldIfString(payload.generation.negative_prompt),
      patches: foldPatchArray(payload.generation.patches),
    };
  }

  if (isRecord(payload.experiment) && isRecord(payload.experiment.overrides)) {
    result.experiment = {
      ...payload.experiment,
      overrides: { ...payload.experiment.overrides, patches: foldPatchArray(payload.experiment.overrides.patches) },
    };
  }

  if (isRecord(payload.options)) {
    result.options = { ...payload.options, prompt_patch: foldIfString(payload.options.prompt_patch) };
  }

  return result;
}

/** Folds a RenderFacts-shaped object's per-sampler prompt.positive/.negative (src/lib/render-facts.ts). */
function foldSamplerPrompts(renderFacts: unknown): unknown {
  if (!isRecord(renderFacts) || !Array.isArray(renderFacts.samplers)) return renderFacts;
  return {
    ...renderFacts,
    samplers: renderFacts.samplers.map((sampler) => {
      if (!isRecord(sampler) || !isRecord(sampler.prompt)) return sampler;
      return {
        ...sampler,
        prompt: { ...sampler.prompt, positive: foldIfString(sampler.prompt.positive), negative: foldIfString(sampler.prompt.negative) },
      };
    }),
  };
}

/** getGenerationDetail output (src/lib/generations.ts) with prompt bodies folded. */
export function foldGenerationDetailPrompts<T>(detail: T): T {
  if (!isRecord(detail)) return detail;
  const result: Record<string, unknown> = { ...detail };

  if (isRecord(detail.batch)) {
    result.batch = {
      ...detail.batch,
      prompt: foldIfString(detail.batch.prompt),
      negative_prompt: foldIfString(detail.batch.negative_prompt),
    };
  }

  if (isRecord(detail.comfy_job)) {
    const comfyJob: Record<string, unknown> = { ...detail.comfy_job, render_facts: foldSamplerPrompts(detail.comfy_job.render_facts) };
    // comfy_job.graph embeds every CLIPTextEncode text and is huge; REST still returns it as-is.
    if (comfyJob.graph !== null && comfyJob.graph !== undefined) {
      comfyJob.graph = null;
      comfyJob.graph_omitted = true;
    }
    result.comfy_job = comfyJob;
  }

  return result as T;
}

/** getBatchDigest output (src/lib/batches.ts) with prompt bodies folded. */
export function foldBatchDigestPrompts<T>(digest: T): T {
  if (!isRecord(digest)) return digest;
  const result: Record<string, unknown> = { ...digest };

  if (isRecord(digest.batch)) {
    const batch: Record<string, unknown> = {
      ...digest.batch,
      prompt: foldIfString(digest.batch.prompt),
      negative_prompt: foldIfString(digest.batch.negative_prompt),
    };
    if (isRecord(digest.batch.parameters)) {
      batch.parameters = { ...digest.batch.parameters, prompt_patch: foldIfString(digest.batch.parameters.prompt_patch) };
    }
    result.batch = batch;
  }

  if (Array.isArray(digest.jobs)) {
    result.jobs = digest.jobs.map((job) => (isRecord(job) ? { ...job, render_facts: foldSamplerPrompts(job.render_facts) } : job));
  }

  return result as T;
}
