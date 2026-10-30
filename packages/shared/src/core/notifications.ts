import { z } from "zod";

export interface NotificationView {
  id: string;
  at: string;
  kind: string;
  title: string;
  body: string | null;
  /** Where in the app it leads, e.g. /gigs/01… */
  url: string | null;
  read_at: string | null;
}

export interface NotificationsView {
  items: NotificationView[];
  unread: number;
  /**
   * Unread, leaving out questions asked of me (a `/cards/` link: they wait under Needs you in the
   * Inbox), counted over the whole inbox, not only the items sent.
   */
  unread_updates?: number;
}

/** Push set-up for this device: the app's public key and whether this device is on. */
export interface PushStatusView {
  public_key: string;
  devices: number;
  this_device: boolean;
}

export const PushSubscribeInput = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
  label: z.string().trim().max(60).optional(),
});

export const PushEndpointInput = z.object({ endpoint: z.string().url().max(1000).optional() });
