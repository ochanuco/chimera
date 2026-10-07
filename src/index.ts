import { app } from './app';
import { recompressRetainedOriginals } from './lib/original-recompress';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

async function scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(recompressRetainedOriginals(env, new Date(controller.scheduledTime).toISOString()));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;
