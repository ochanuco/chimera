import { z } from 'zod';

// role is free-form by design (no enum) — vocabulary lives in docs/domain-model.md, not code.
const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const ingestGenerationAssetMetadataSchema = z.object({
  role: tokenSchema,
  // '' means "whole image, no region"; omitted key and null both mean "no region" (request.json nullish convention, docs/domain-model.md).
  region: tokenSchema.nullish(),
  content_type: z.string().min(1).optional(),
});

export type IngestGenerationAssetMetadataInput = z.infer<typeof ingestGenerationAssetMetadataSchema>;
