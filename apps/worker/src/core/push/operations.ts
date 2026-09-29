// Notifications and push set-up (T11). Devices are managed from a signed-in session only.
import { z } from "zod";
import {
  PushEndpointInput,
  PushSubscribeInput,
  type NotificationsView,
  type PushStatusView,
} from "@assistant/shared";
import { defineOperation, type OpUserCtx } from "../operations.ts";
import { AppError } from "../errors.ts";
import { inboxName } from "./notify.ts";
import { isPushEndpoint, vapidKeys } from "./webpush.ts";

const inbox = (ctx: OpUserCtx) => ctx.objects.INBOX.getByName(inboxName(ctx.user.id));

async function status(ctx: OpUserCtx, endpoint?: string): Promise<PushStatusView> {
  const box = inbox(ctx);
  return {
    public_key: (await vapidKeys(ctx.d1, ctx.sealer)).publicKey,
    devices: await box.deviceCount(),
    this_device: endpoint ? await box.hasDevice(endpoint) : false,
  };
}

export const notificationOperations = [
  defineOperation({
    id: "core.get_notifications",
    tool: "get_notifications",
    description: "My latest notifications (gig changes, payments) and how many are unread.",
    kind: "read",
    http: { method: "GET", path: "/me/notifications" },
    input: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
    handler: (ctx, input): Promise<NotificationsView> => inbox(ctx).list(input.limit),
  }),
  defineOperation({
    id: "core.mark_notifications_read",
    tool: "mark_notifications_read",
    description: "Mark all my notifications as read.",
    kind: "write",
    http: { method: "POST", path: "/me/notifications/read" },
    input: z.object({}),
    handler: (ctx) => inbox(ctx).markAllRead(),
  }),
  defineOperation({
    id: "core.get_push_status",
    tool: "get_push_status",
    description: "Push notification set-up: the app's public key and my devices.",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/me/push" },
    input: PushEndpointInput,
    handler: (ctx, input) => status(ctx, input.endpoint),
  }),
  defineOperation({
    id: "core.add_push_device",
    tool: "add_push_device",
    description: "Turn on notifications on this device (a browser push subscription).",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/me/push" },
    input: PushSubscribeInput,
    handler: async (ctx, input) => {
      if (!isPushEndpoint(input.endpoint))
        throw new AppError("validation_failed", "That isn't a push service this app supports");
      await inbox(ctx).addDevice({ endpoint: input.endpoint, ...input.keys, label: input.label });
      return status(ctx, input.endpoint);
    },
  }),
  defineOperation({
    id: "core.remove_push_device",
    tool: "remove_push_device",
    description: "Turn off notifications on this device.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/me/push/remove" },
    input: PushEndpointInput,
    handler: async (ctx, input) => {
      if (input.endpoint) await inbox(ctx).removeDevice(input.endpoint);
      return status(ctx, input.endpoint);
    },
  }),
  defineOperation({
    id: "core.test_push",
    tool: "test_push",
    description: "Send a test notification to my devices.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/me/push/test" },
    input: z.object({}),
    handler: async (ctx) => ({
      sent: await inbox(ctx).notify({
        kind: "test",
        title: "Notifications are on",
        body: "You'll hear about gig changes and payments here.",
        url: "/settings",
      }),
    }),
  }),
];
