import { app } from './app';
import { sweepReferenceImages } from './lib/reference-images';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

async function scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(sweepReferenceImages(env.IMAGES, controller.scheduledTime));
}

export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Bindings>;
