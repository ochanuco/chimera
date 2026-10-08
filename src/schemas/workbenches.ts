import { z } from 'zod';

export const WORKBENCH_PHASES = ['1', '2', '3', '4', '5'] as const;

const pickSchema = z.union([z.object({ generation_id: z.string().min(1) }).strict(), z.object({ skip: z.literal(true) }).strict()]);

/** PUT /api/v1/workbenches/:rootId — picks は丸ごと置き換える。キーはフェーズ番号 "1".."5"。 */
export const putWorkbenchSchema = z
  .object({
    picks: z.record(z.string(), pickSchema).superRefine((picks, ctx) => {
      for (const key of Object.keys(picks)) {
        if (!(WORKBENCH_PHASES as readonly string[]).includes(key)) {
          ctx.addIssue({ code: 'custom', message: `phase key must be one of 1..5, got '${key}'`, path: [key] });
        }
      }
    }),
  })
  .strict();

export type WorkbenchPicks = Record<string, { generation_id: string } | { skip: true }>;
