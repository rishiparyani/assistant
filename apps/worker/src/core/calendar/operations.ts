// Core operations for the private calendar feed link (the feed route is in core/app.ts).
import { z } from "zod";
import { EnableCalendarFeedInput } from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import { disableCalendarFeed, enableCalendarFeed, getCalendarFeed } from "./service.ts";

export const calendarOperations = [
  defineOperation({
    id: "core.get_calendar_feed",
    tool: "get_calendar_feed",
    description: "My private calendar feed link (for Apple or Google Calendar), if switched on.",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/me/calendar" },
    input: z.object({}),
    handler: (ctx) => getCalendarFeed(ctx),
  }),
  defineOperation({
    id: "core.enable_calendar_feed",
    tool: "enable_calendar_feed",
    description:
      "Switch on my private calendar feed and get its link; reset=true makes a new link and stops the old one.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/me/calendar" },
    input: EnableCalendarFeedInput,
    handler: (ctx, input) => enableCalendarFeed(ctx, input.reset ?? false),
  }),
  defineOperation({
    id: "core.disable_calendar_feed",
    tool: "disable_calendar_feed",
    description: "Switch off my calendar feed; the link stops working.",
    kind: "write",
    sessionOnly: true,
    confirm: true,
    http: { method: "DELETE", path: "/me/calendar" },
    input: z.object({}),
    handler: (ctx) => disableCalendarFeed(ctx),
  }),
];
