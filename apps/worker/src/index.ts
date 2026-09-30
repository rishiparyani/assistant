import { createApp } from "./core/app.ts";
import { queueHandler } from "./core/queues.ts";
import { scheduledHandler } from "./core/scheduled.ts";
import { backupDue, runBackup } from "./core/backup/service.ts";
import { modules } from "./modules/index.ts";

const app = createApp({ modules });

export default {
  fetch: app.fetch,
  queue: queueHandler(modules),
  scheduled: scheduledHandler(modules, [
    {
      id: "backup",
      due: backupDue,
      run: (env, now) => runBackup(env, modules, undefined, now).then(() => undefined),
    },
  ]),
} satisfies ExportedHandler<Env>;

// Durable Object classes are found by their export name (wrangler.jsonc).
export {
  BookingObject,
  MonthIndexObject,
  PendingObject,
  PersonObject,
} from "./modules/gigs/objects/index.ts";

// Music: one song library per person.
export { LibraryObject } from "./modules/music/objects/library.ts";

// Core: one inbox (notifications, push devices) per person.
export { InboxObject } from "./core/push/inbox.ts";
