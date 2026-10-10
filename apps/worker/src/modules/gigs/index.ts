import { defineModule } from "../../core/module.ts";
import * as schema from "./schema.ts";
import { bookingOperations } from "./operations-bookings.ts";
import { collabOperations } from "./operations-collab.ts";
import { guestOperations } from "./operations-guests.ts";
import { GUEST_LINK_PREFIX, sharedGuestAction, sharedGuestList } from "./services/guests.ts";
import { consumeSummaries, recordDeadLetters } from "./objects/delivery.ts";
import { gigsAdmin } from "./admin.ts";
import { attachPendingPeople } from "./services/tags.ts";
import { exportGigs, importGigs } from "./backup.ts";
import { gigsCalendar } from "./calendar.ts";

export const gigsModule = defineModule({
  id: "gigs",
  name: "Gigs",
  schema,
  operations: [...bookingOperations, ...collabOperations, ...guestOperations],
  sharedLinks: { prefix: GUEST_LINK_PREFIX, read: sharedGuestList, act: sharedGuestAction },
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
  // My gigs in my private calendar feed.
  calendar: gigsCalendar,
});
