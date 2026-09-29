// Core operations that aren't about any module: who's signed in.
import { z } from "zod";
import type { MeResponse } from "@assistant/shared";
import { defineOperation } from "./operations.ts";
import { calendarOperations } from "./calendar/operations.ts";
import { apiTokenOperations } from "./api-tokens.ts";
import { notificationOperations } from "./push/operations.ts";

export const coreOperations = [
  defineOperation({
    id: "core.get_me",
    tool: "get_me",
    description: "The signed-in user.",
    kind: "read",
    http: { method: "GET", path: "/me" },
    input: z.object({}),
    handler: async (ctx): Promise<MeResponse> => ({ user: ctx.user }),
  }),
  ...calendarOperations,
  ...apiTokenOperations,
  ...notificationOperations,
];
