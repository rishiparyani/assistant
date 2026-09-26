// T00 spike: a minimal stateless MCP server (Streamable HTTP, JSON responses only).
// Just enough protocol for a client to connect and call one tool. T10 replaces this
// with tools generated from the operation registry.

export interface McpUser {
  name: string;
  email: string;
  workspaces: { name: string; kind: string | null; role: string }[];
}

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

const TOOLS = [
  {
    name: "whoami",
    title: "Who am I",
    description: "Returns the signed-in user's name, email and workspaces. Spike test tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

function result(id: JsonRpcRequest["id"], value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function handle(msg: JsonRpcRequest, user: McpUser) {
  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return result(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "assistant-spike", version: "0.0.0" },
        instructions: "Spike server for the Assistant app. Only a whoami tool exists.",
      });
    }
    case "ping":
      return result(msg.id, {});
    case "tools/list":
      return result(msg.id, { tools: TOOLS });
    case "tools/call": {
      if (msg.params?.name !== "whoami") return error(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      const lines = [
        `Signed in as ${user.name} <${user.email}>.`,
        user.workspaces.length
          ? `Workspaces: ${user.workspaces.map((w) => `${w.name} (${w.kind ?? "?"}, ${w.role})`).join("; ")}`
          : "No workspaces yet.",
      ];
      return result(msg.id, {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: user,
      });
    }
    default:
      return error(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpPost(request: Request, user: McpUser): Promise<Response> {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await request.json();
  } catch {
    return Response.json(error(null, -32700, "Parse error"), { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  // Notifications and responses (no id or no method) get no reply.
  const requests = messages.filter(
    (m) => m && typeof m.method === "string" && m.id !== undefined && m.id !== null,
  );
  if (requests.length === 0) return new Response(null, { status: 202 });
  const replies = requests.map((m) => handle(m, user));
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}
