import { defineModule } from "../../core/module.ts";
import * as schema from "./schema.ts";
import { gigsOperations } from "./operations.ts";

export const gigsModule = defineModule({ id: "gigs", name: "Gigs", schema, operations: gigsOperations });
