# Date options (holds)

Decided 2026-10-03 (docs/decisions.md). Owner: "someone could ask us to soft block two dates or three dates".

- **A date option is a show marked `hold`** on an enquiry: the client hasn't picked yet. New gig → Enquiry → "Date options", or Add → "Date option (hold)" on an enquiry. Booking object migration 11 (`events.hold`), person object `my_events.hold`.
- **Everyone sees them as holds**: amber "Hold" on Home, the Gigs list and calendar ("Hold: …"), the calendar feed ("Hold: …", tentative), so nobody takes those dates. Duplicate warnings count them like any show.
- **Confirming picks the date**: `set_gig_status` confirm with `keep_event_ids` (the web asks "Which date did they pick?"; one or more). Picked holds become normal shows; the rest are released (soft-deleted, history says "Client picked …", "Released …"). Without a pick, confirming is refused (`pick_date`), as is marking it played.
- **Rules**: holds only on enquiries of kind gig (`hold_needs_enquiry`); no lineup on a hold (`hold_no_lineup`) so options never count as shares; releasing a hold = removing that event.

Later: a reminder before a hold goes stale; telling the client which dates are held.
