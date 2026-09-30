# Music module: songs, chord charts, stage mode

Decided 2026-09-30 (docs/decisions.md). The second module, after gigs. Phase 2 step 1 of the roadmap; arrangements, chart revisions and the band stage hub come later.

## What it does

- **My song library.** Each person has their own songs: title, artist, key, tempo, capo, notes and a chord chart. Songs are private (another person gets 404). Up to 2000 songs.
- **Chord charts** are stored as [ChordPro](https://www.chordpro.org/) text: chords in brackets inside the lyrics (`[G]Test line [C]one`), sections with `{c: Chorus}`, `{soc}`…`{eoc}` or a line like `[Chorus]` / `Verse 2:`. Pasting from a chord site ("chords above the lyrics") is detected, and one tap converts it (`chordsOverLyricsToChordPro`).
- **Transpose** by semitones on the song page; the choice is kept per song on this device (`localStorage` `transpose:<song id>`), not on the server. Keys that are usually written with flats (F, Bb, Eb, Ab, Db and their minors Dm, Gm, Cm, Fm, Bbm, Ebm) get flat chords; the rest get sharps.
- **Stage mode**: full screen, dark, big text, the screen kept awake, auto-scroll with a speed, bigger/smaller text. A Bluetooth page turner (arrow, page or space keys) pages down, and at the end of a song goes to the next song in the setlist.
- **Setlists** are ordinary gig lists (gigs module) whose items carry a `song_id`. "Add songs" on a list opens a picker (search, tap in the order to play them); the items get the song's title and facts ("G · 96 bpm"). The list's Play button opens stage mode for its songs in order, each in its own key. Everyone on the gig sees the list; the chart only opens for the song's owner (for now; see "Later").

## Where things live

| Piece                                                      | Where                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Schemas, `SongSummary`, `SongView`, `SONG_LIMITS`          | `packages/shared/src/modules/music/songs.ts`                                                      |
| ChordPro parsing, conversion, transposition (pure, tested) | `packages/shared/src/modules/music/chordpro.ts`                                                   |
| Library object (`library:<user id>`)                       | `apps/worker/src/modules/music/objects/library.ts`                                                |
| Services and operations                                    | `apps/worker/src/modules/music/services/songs.ts`, `operations.ts`                                |
| Backup (per person, from D1 users)                         | `apps/worker/src/modules/music/backup.ts`                                                         |
| Screens                                                    | `apps/web/src/modules/music/` (SongsPage, SongPage, SongSheet, ChordChart, StageView, SongPicker) |
| Setlist link                                               | `song_id` on gig list items (booking object migration 8; `ListItemInput.song_id`)                 |

Search is by word start, through an indexed `song_words` table (each word of the title and artist): every word typed must start a word of the song ("tes ban" finds "Test Song" by "Test Band"). The web app filters its saved list the same way offline (`matchesSongSearch` in shared).

The library object follows the architecture rules: one object per person (no shared write place), ULIDs (ids made on the device accepted), idempotency keys and audit inside the object, soft delete, index on `(deleted_at, title_key)`. Titles sort ignoring a leading "The", "A" or "An".

## Operations (REST + MCP)

`find_songs` (`GET /api/songs?q=`), `get_song` (`GET /api/songs/:song_id`), `create_song` (`POST /api/songs`), `update_song` (`PATCH /api/songs/:song_id`), `remove_song` (`DELETE /api/songs/:song_id`, needs confirmation from MCP). `all_songs` (`GET /api/songs-all`, whole library with charts) is for the web app's offline copy only (session only, not an MCP tool). Gig list items take `song_id`, so an assistant can build a setlist with `find_songs` + `add_list_items`.

## Offline

Reading works offline: the whole library with charts is saved ahead (`saveSongsAhead`) in IndexedDB (`core/device-db.ts`, scope `library:<user id>`; it can be megabytes, too big for the localStorage cache), and the list without charts in the ordinary cache (`songs:list:`). So songs, transposing, stage mode and setlists open at a gig with no signal; Play uses the saved charts first and asks the server only for songs not saved yet. Sign-out deletes the device database. Adding and editing songs is online-only for now (`// online-only:` in `music-api.ts`); songs are prepared at home, not at the gig.

## Navigation

Songs is a main tab. On phones the tab bar has five places (Home, Gigs, Songs, Reports, Contacts); Settings moved to the avatar in the top bar (it stays in the sidebar on wider screens).

## Later

- Band sharing: a collective's shared songbook, and charts opening for everyone on a setlist.
- Chart revisions and arrangements (per band, per singer's key); editing songs offline through the outbox.
- Stage hub (roadmap phase 3): the leader turns the page and every screen follows.
