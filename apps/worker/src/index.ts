import { createApp } from "./core/app.ts";
import { queueHandler } from "./core/queues.ts";
import { scheduledHandler } from "./core/scheduled.ts";
import { modules } from "./modules/index.ts";

const app = createApp({ modules });

export default {
  fetch: app.fetch,
  queue: queueHandler(modules),
  scheduled: scheduledHandler(modules),
} satisfies ExportedHandler<Env>;

// Durable Object classes are found by their export name (wrangler.jsonc).
export {
  BookingObject,
  MonthIndexObject,
  PendingObject,
  PersonObject,
} from "./modules/gigs/objects/index.ts";
