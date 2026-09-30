// The music module's part of nightly backups: everyone's song library.
import type { AdminCtx } from "../../core/module.ts";
import { libraryName } from "./objects/names.ts";

export interface MusicBackup {
  /** user id → song rows */
  songs: Record<string, Awaited<ReturnType<LibraryStub["exportAll"]>>>;
}
type LibraryStub = ReturnType<AdminCtx["objects"]["LIBRARIES"]["getByName"]>;

export async function exportMusic(ctx: AdminCtx): Promise<MusicBackup> {
  const songs: MusicBackup["songs"] = {};
  const { results } = await ctx.d1.prepare(`select id from user`).all<{ id: string }>();
  for (const { id } of results) {
    const rows = await ctx.objects.LIBRARIES.getByName(libraryName(id)).exportAll();
    if (rows.length) songs[id] = rows;
  }
  return { songs };
}

/** Restores libraries that are empty; existing songs are left alone. */
export async function importMusic(ctx: AdminCtx, data: unknown): Promise<number> {
  let restored = 0;
  for (const [userId, rows] of Object.entries((data as MusicBackup | null)?.songs ?? {}))
    restored += await ctx.objects.LIBRARIES.getByName(libraryName(userId)).importAll(rows);
  return restored;
}
