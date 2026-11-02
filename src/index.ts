import { app } from './app';
import { sweepReferenceImages } from './lib/reference-images';
import { expireTemporaryRecords } from './lib/temporary-records';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

async function scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(sweepReferenceImages(env.IMAGES, controller.scheduledTime));
  ctx.waitUntil(expireTemporaryRecords(env.DB, controller.scheduledTime));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;
