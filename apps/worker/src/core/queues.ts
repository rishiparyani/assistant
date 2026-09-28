// Routes queue batches to the module that consumes that queue. Core never imports a
// module: the modules are passed in (src/index.ts).
import type { ModuleDefinition } from "./module.ts";

export function queueHandler(modules: readonly ModuleDefinition[]) {
  const queues = modules.flatMap((m) => m.queues ?? []);
  return async (batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) => {
    const q = queues.find((x) => batch.queue === x.name || batch.queue === (x.devName ?? `${x.name}-dev`));
    if (!q) {
      console.error(`queue: no consumer for ${batch.queue}`);
      batch.retryAll();
      return;
    }
    await q.handle(batch, env, ctx);
  };
}
