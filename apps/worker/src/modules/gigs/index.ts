import { defineModule } from "../../core/module.ts";
import * as schema from "./schema.ts";
import { gigsOperations } from "./operations.ts";
import { bookingOperations } from "./operations-bookings.ts";
import { memberJoined } from "./services/roster-link.ts";
import { consumeSummaries } from "./objects/delivery.ts";

export const gigsModule = defineModule({
  id: "gigs",
  name: "Gigs",
  schema,
  operations: [...gigsOperations, ...bookingOperations],
  hooks: { memberJoined },
  queues: [{ name: "summaries", handle: (batch, env) => consumeSummaries(batch, env) }],
});
