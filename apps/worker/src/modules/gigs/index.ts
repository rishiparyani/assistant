import { defineModule } from "../../core/module.ts";
import * as schema from "./schema.ts";
import { bookingOperations } from "./operations-bookings.ts";
import { consumeSummaries, recordDeadLetters } from "./objects/delivery.ts";
import { gigsAdmin } from "./admin.ts";
import { attachPendingPeople } from "./services/tags.ts";
import { personName } from "./objects/names.ts";
import { exportGigs, importGigs } from "./backup.ts";
import { gigsCalendar } from "./calendar.ts";

export const gigsModule = defineModule({
  id: "gigs",
  name: "Gigs",
  schema,
  operations: bookingOperations,
  hooks: {
    userCreated: (deps, user) => attachPendingPeople(deps.d1, deps.objects, user).then(() => undefined),
  },
  queues: [
    { name: "summaries", handle: (batch, env) => consumeSummaries(batch, env) },
    // Deliveries that failed every retry: recorded for the alert and the retry tool.
    {
      name: "summaries-dlq",
      devName: "summaries-dev-dlq",
      handle: (batch, env) => recordDeadLetters(batch, env.DB),
    },
  ],
  admin: gigsAdmin,
  backup: { export: (ctx) => exportGigs(ctx), import: importGigs },
  // Each person's object holds their open apps' WebSockets and tells them when a gig
  // they're on changes.
  live: (env, userId, request) => env.PEOPLE.getByName(personName(userId)).fetch(request),
  // My gigs in my private calendar feed.
  calendar: gigsCalendar,
});
