# Rehearsals

Decided 2026-10-02 (docs/decisions.md). Owner: "most of the time it's going to be with a gig only, and unlinking with a gig could be optional".

## Shape

- **A rehearsal is an event of its gig** with `kind = 'rehearsal'` (shows are `kind = 'show'`, the default). So it reaches everyone on the gig with no new plumbing: Home, the Gigs list and calendar, the calendar feed, notifications, offline copies, and the gig's lists and notes (setlists to practise).
- **A rehearsal that isn't for any gig** is a gig of `kind = 'rehearsal'`: no client, no fee, status always on (confirmed), only rehearsal events, no Money tab. Its people are added like a gig's (optionally the band's people from its last gig).
- A normal gig keeps at least one show (`no_show` / `last_show`), so it never turns into a rehearsal by accident.
- **Who's coming:** everyone on the gig answers Going / Can't make it for each rehearsal (`attendance (event_id, person_id, going)` in the booking object, migration 10). Managers can answer for someone (API/MCP). Answering doesn't bump the gig's version (like lists), so it never blocks an edit. Rehearsals have no lineup or shares (`rehearsal_no_lineup`).
- **Dates and money:** a gig's date in reports is its first show's (rehearsals before it don't move it); rehearsals aren't in duplicate warnings; gigs of kind rehearsal are left out of reports and Home's money and gig counts.

## Where things are

| Piece                                                                                                        | Where                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Schemas (`EVENT_KINDS`, `GIG_KINDS`, `SetAttendanceInput`, `AttendanceView`)                                 | `packages/shared/src/modules/gigs/booking.ts`                    |
| Rules, attendance, summaries                                                                                 | `apps/worker/src/modules/gigs/objects/booking.ts` (migration 10) |
| My rows (`kind`, my `going`), "Rehearsal for …" notice                                                       | `objects/person.ts` (migration 10)                               |
| Operation `set_rehearsal_attendance` (`PUT /api/gigs/:id/events/:event_id/attendance`); `find_my_gigs?kind=` | `operations-bookings.ts`                                         |
| Calendar feed ("Rehearsal: …", my answer), Siri brief (next gig = next show)                                 | `calendar.ts`, `services/brief.ts`                               |
| Gig page section, Going / Can't                                                                              | `apps/web/src/modules/gigs/booking/GigRehearsals.svelte`         |
| New → Rehearsal (gig picked by default; "Not for a gig"), edit one of its own                                | `RehearsalSheet.svelte`, `NewButton.svelte`                      |
| Rows (violet date tile, "Coming?" / "Going" / "Can't go")                                                    | `GigEventRow.svelte`, `Home.svelte`, `status.ts`                 |

Answering is online-only for now (`// online-only:` in `gigs-api.ts`); it's done ahead of time.

## Later

- Repeating rehearsals (every Tuesday 7–10 pm).
- Moving an existing rehearsal out of its gig (today: delete it and make one "Not for a gig").
- Studio cost split as an expense on the rehearsal; reminders the day before.
