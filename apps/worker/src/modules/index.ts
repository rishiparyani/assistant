// The one list of registered modules. Add a module here (and record a decision).
import type { ModuleDefinition } from "../core/module.ts";
import { gigsModule } from "./gigs/index.ts";
import { musicModule } from "./music/index.ts";

export const modules: readonly ModuleDefinition[] = [gigsModule, musicModule];
