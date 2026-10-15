import type { z } from 'zod';
import type { ValidationIssue } from '../lib/validate';

/** lib の規則関数が返す ValidationIssue を、refinement の issue として積む。 */
export function addIssues(ctx: z.RefinementCtx, issues: readonly ValidationIssue[]): void {
  for (const issue of issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
}
