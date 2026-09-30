// The music module (docs/design/music.md): each person's song library with chord charts.
// Setlists are the gigs module's lists, whose items can point at a song.
import { defineModule } from "../../core/module.ts";
import { musicOperations } from "./operations.ts";
import { exportMusic, importMusic } from "./backup.ts";

export const musicModule = defineModule({
  id: "music",
  name: "Music",
  operations: musicOperations,
  backup: { export: exportMusic, import: importMusic },
});
