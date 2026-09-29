// A gig's guest list. Everyone on the gig adds their own guests until the list closes;
// managers add for anyone, set limits and share a link with the venue. Making or changing
// that link is app-only (like other secret links), so AI assistants can't hand one out.
import {
  AddGigGuestsInput,
  BookingRef,
  GigGuestRef,
  GuestLinkInput,
  SetGuestListInput,
  UpdateGigGuestInput,
} from "@assistant/shared";
import { defineOperation } from "../../core/operations.ts";
import * as g from "./services/guests.ts";

export const guestOperations = [
  defineOperation({
    id: "gigs.add_gig_guests",
    tool: "add_gig_guests",
    description:
      "Put people on a gig's guest list (name, plus_ones, note). They count against the list's limits; each guest is 1 + plus_ones. Managers can add for someone else with host_person_id. get_gig returns guest_list (players see only their own guests).",
    kind: "write",
    http: { method: "POST", path: "/gigs/:gig_id/guests", status: 201 },
    input: AddGigGuestsInput,
    handler: (ctx, input) => g.addGuests(ctx, input),
  }),
  defineOperation({
    id: "gigs.update_gig_guest",
    tool: "update_gig_guest",
    description: "Change a guest's name, plus-ones or note, or (managers) mark them arrived.",
    kind: "write",
    http: { method: "PATCH", path: "/gigs/:gig_id/guests/:guest_id" },
    input: UpdateGigGuestInput,
    handler: (ctx, input) => g.updateGuest(ctx, input),
  }),
  defineOperation({
    id: "gigs.remove_gig_guest",
    tool: "remove_gig_guest",
    description: "Take someone off a gig's guest list (your own guests, or anyone's if you manage the gig).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/gigs/:gig_id/guests/:guest_id" },
    input: GigGuestRef,
    handler: (ctx, input) => g.removeGuest(ctx, input.gig_id, input.guest_id),
  }),
  defineOperation({
    id: "gigs.set_guest_list",
    tool: "set_guest_list",
    description:
      "Set a gig's guest list limits (total heads, heads per person) and when it closes for players (managers).",
    kind: "write",
    http: { method: "PATCH", path: "/gigs/:gig_id/guest-list" },
    input: SetGuestListInput,
    handler: (ctx, input) => g.setGuestList(ctx, input),
  }),
  defineOperation({
    id: "gigs.get_guest_link",
    tool: "get_guest_link",
    description: "The gig's guest list link for the venue, if on (managers).",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/gigs/:gig_id/guest-link" },
    input: BookingRef,
    handler: (ctx, input) => g.getGuestLink(ctx, input.gig_id),
  }),
  defineOperation({
    id: "gigs.enable_guest_link",
    tool: "enable_guest_link",
    description:
      "Switch on the venue link (or make a new one with reset), and choose whether door staff can tick arrivals (managers).",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/gigs/:gig_id/guest-link" },
    input: GuestLinkInput,
    handler: (ctx, input) => g.enableGuestLink(ctx, input),
  }),
  defineOperation({
    id: "gigs.disable_guest_link",
    tool: "disable_guest_link",
    description: "Switch off the venue link; it stops working (managers).",
    kind: "write",
    sessionOnly: true,
    http: { method: "DELETE", path: "/gigs/:gig_id/guest-link" },
    input: BookingRef,
    handler: (ctx, input) => g.disableGuestLink(ctx, input.gig_id),
  }),
];
