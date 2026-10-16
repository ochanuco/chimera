import { z } from 'zod';
import { workbenchPicksIssues } from '../lib/workbench-rules';
import { addIssues } from './issues';

const pickSchema = z.union([z.object({ generation_id: z.string().min(1) }).strict(), z.object({ skip: z.literal(true) }).strict()]);

/** PUT /api/v1/workbenches/:rootId — picks は丸ごと置き換える。キーはフェーズ番号 "1".."6"（描き直し / フチ / 彩度 / 背景 / 光 / ボケ）。 */
export const putWorkbenchSchema = z
  .object({
    picks: z.record(z.string(), pickSchema).superRefine((picks, ctx) => addIssues(ctx, workbenchPicksIssues(picks))),
  })
  .strict();

export type WorkbenchPicks = Record<string, { generation_id: string } | { skip: true }>;
