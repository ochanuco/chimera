import { app } from './app';
import { purgeOldOriginals } from './lib/original-purge';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

async function scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(purgeOldOriginals(env, new Date(controller.scheduledTime).toISOString()));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;
