import { z } from 'zod';

// role / region share the same token shape: lowercase, digits, `.` `_` `-`,
// starting with an alphanumeric. role is a free string by design (no enum) —
// recommended vocabulary lives in docs/domain-model.md, not in code.
const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const ingestGenerationAssetMetadataSchema = z.object({
  role: tokenSchema,
  // '' is the "whole image, no region" sentinel (see docs/domain-model.md).
  // Omitted key and explicit null both mean "no region", matching this
  // project's request.json nullish-acceptance convention.
  region: tokenSchema.nullish(),
  content_type: z.string().min(1).optional(),
});

export type IngestGenerationAssetMetadataInput = z.infer<typeof ingestGenerationAssetMetadataSchema>;
