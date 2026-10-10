// One person's open apps ("live:<user id>", decision 2026-09-28): each keeps a WebSocket here
// while it's on screen, and anything that changes something they can see sends a short ping
// ("space_changed", "gig_changed") so the app refreshes what's on screen. Pings carry no data:
// the app fetches again, so it only ever sees what the person may see. Connections hibernate
// while idle, so they cost nothing until something changes.
import { DurableObject } from "cloudflare:workers";

/** A few devices at most; the oldest is dropped beyond that. */
const MAX_SOCKETS = 5;

export class LiveObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object (hibernation).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    const open = this.ctx.getWebSockets();
    for (const old of open.slice(0, Math.max(0, open.length - (MAX_SOCKETS - 1)))) {
      try {
        old.close(1000, "Too many connections");
      } catch {
        // already closed
      }
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    // Clients only send pings (answered automatically); nothing else is accepted.
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "Closed");
    } catch {
      // already closed
    }
  }

  /** Tells this person's open apps that something they can see changed. */
  async ping(message: { type: string } & Record<string, string | number>): Promise<number> {
    const text = JSON.stringify(message);
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
        sent++;
      } catch {
        // closed in the meantime
      }
    }
    return sent;
  }
}

/** The live object for a person. */
export const liveOf = (env: Env, userId: string) => env.LIVE.getByName(`live:${userId}`);
