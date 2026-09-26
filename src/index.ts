import { app } from './app';
import { purgeOldOriginals } from './lib/original-purge';
import { recompressRetainedOriginals } from './lib/original-recompress';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

async function runOriginalMaintenance(env: Bindings, now: string): Promise<void> {
  // purge を先に: 保持対象として残った original だけを再圧縮の候補にする。
  await purgeOldOriginals(env, now);
  await recompressRetainedOriginals(env, now);
}

async function scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runOriginalMaintenance(env, new Date(controller.scheduledTime).toISOString()));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;
