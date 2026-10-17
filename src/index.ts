import { app } from './app';
import type { Bindings } from './types';

export { WorkerHub } from './worker-hub';

export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
