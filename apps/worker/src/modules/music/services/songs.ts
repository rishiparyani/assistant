// My song library (docs/design/music.md), kept in my library object.
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import type { SongFields } from "../objects/library.ts";
import { libraryName } from "../objects/names.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const mine = (ctx: OpUserCtx) => ctx.objects.LIBRARIES.getByName(libraryName(ctx.user.id));

export const findSongs = (ctx: OpUserCtx, q: { q?: string; limit?: number }) =>
  mine(ctx).songs({ search: q.q || undefined, limit: q.limit });

export const getSong = (ctx: OpUserCtx, songId: string) => mine(ctx).song(songId);

export const allSongs = (ctx: OpUserCtx) => mine(ctx).allSongs();

export const createSong = (ctx: OpUserCtx, input: SongFields & { id?: string }) =>
  mine(ctx).createSong(actorOf(ctx), ctx.idempotencyKey, input);

export const updateSong = (ctx: OpUserCtx, input: Partial<SongFields> & { song_id: string }) => {
  const { song_id, ...fields } = input;
  return mine(ctx).updateSong(actorOf(ctx), ctx.idempotencyKey, song_id, fields);
};

export const removeSong = (ctx: OpUserCtx, songId: string) =>
  mine(ctx).removeSong(actorOf(ctx), ctx.idempotencyKey, songId);
