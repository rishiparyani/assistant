// Core operations that aren't about any module: who's signed in.
import { z } from "zod";
import type { MeResponse } from "@assistant/shared";
import { defineOperation } from "./operations.ts";
import { calendarOperations } from "./calendar/operations.ts";
import { apiTokenOperations } from "./api-tokens.ts";
import { notificationOperations } from "./push/operations.ts";
import { assistantAllowed } from "./assistant/access.ts";
import { ownerActorOf, practiceStub } from "./spaces/service.ts";

export const coreOperations = [
  defineOperation({
    id: "core.get_me",
    tool: "get_me",
    description: "The signed-in user.",
    kind: "read",
    http: { method: "GET", path: "/me" },
    input: z.object({}),
    handler: async (ctx): Promise<MeResponse> => {
      // Rehearsing: the person played, with no assistant (docs/design/from-scratch.md §3).
      if (ctx.practice) {
        const me = ctx.practice.as === ctx.user.id;
        const who = me ? null : await practiceStub(ctx)!.practiceWho(ownerActorOf(ctx), ctx.practice.as);
        return {
          user: me ? ctx.user : { id: ctx.practice.as, name: who!.name, email: "", image: null },
          assistant: false,
          practice: ctx.practice,
        };
      }
      return { user: ctx.user, assistant: await assistantAllowed(ctx) };
    },
  }),
  ...calendarOperations,
  ...apiTokenOperations,
  ...notificationOperations,
];
