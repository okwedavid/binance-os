import { AgentOSError } from "@/lib/agentos/adapter";
import {
  refreshStoredSession,
  readStoredSession,
  type StoredSession,
} from "@/lib/agentos/binance/oauth";

/**
 * Minimal server-side MCP client for the Binance Agent OS MCP server.
 *
 * Uses the official `@modelcontextprotocol/sdk` over Streamable HTTP.
 * A fresh session is opened inside each server request (serverless-safe:
 * no long-lived in-memory session state). Tokens come from the httpOnly
 * session cookie and are refreshed on expiry.
 */

export interface McpTool {
  name: string;
  description: string | null;
  requiredInputs: string[];
  /** All declared input property names (camelCase preserved), including optional ones. */
  properties: string[];
}

interface ToolResultData {
  structured: Record<string, unknown> | null;
  text: string | null;
}

export class AgentOsMcpSession {
  private constructor(
    private readonly client: import("@modelcontextprotocol/sdk/client/index.js").Client,
    private readonly transport: import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport
  ) {}

  static async open(session: StoredSession): Promise<AgentOsMcpSession> {
    const [
      { Client },
      { StreamableHTTPClientTransport },
      { AGENT_OS_MCP_URL },
    ] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
      import("@/lib/agentos/binance/oauth"),
    ]);

    const transport = new StreamableHTTPClientTransport(new URL(AGENT_OS_MCP_URL), {
      requestInit: {
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    });
    const client = new Client(
      { name: "risklens", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport, { timeout: 30_000 });
    return new AgentOsMcpSession(client, transport);
  }

  async close(): Promise<void> {
    try {
      await this.transport.close();
    } catch {
      // Closing a session must never fail an already-successful read.
    }
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.client.listTools(undefined, { timeout: 30_000 });
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? null,
      requiredInputs:
        Array.isArray(tool.inputSchema?.required)
          ? (tool.inputSchema?.required ?? []).filter((r): r is string => typeof r === "string")
          : [],
      properties: Object.keys(
        tool.inputSchema?.properties && typeof tool.inputSchema.properties === "object"
          ? (tool.inputSchema.properties as Record<string, unknown>)
          : {}
      ),
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResultData> {
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 45_000 }
    );

    let structured: Record<string, unknown> | null = null;
    if (result.structuredContent !== undefined) {
      const sc = result.structuredContent as unknown;
      if (sc !== null && typeof sc === "object") {
        structured = sc as Record<string, unknown>;
      }
    }

    const content = (result.content ?? []) as readonly Record<string, unknown>[];
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item.text === "string") {
        parts.push(item.text);
      } else if (item && typeof item.displayData === "string") {
        parts.push(item.displayData);
      }
    }
    const text = parts.length > 0 ? parts.join("\n") : null;

    if (result.isError) {
      throw new AgentOSError(
        "CAPABILITY_UNAVAILABLE",
        `Agent OS returned an error for ${name}: ${text ?? "unknown error"}`
      );
    }

    return { structured, text };
  }
}

/**
 * Runs `handler` with a fresh MCP session, retrying once after a token
 * refresh when the server reports the session is unauthorized.
 */
export async function withAgentOsSession<T>(
  handler: (session: AgentOsMcpSession) => Promise<T>
): Promise<T> {
  const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");

  const initial = await readStoredSession();
  if (!initial) {
    throw new AgentOSError(
      "AUTHORIZATION_REQUIRED",
      "No Agent OS authorization is present on this browser."
    );
  }

  const attempt = async (session: StoredSession): Promise<T> => {
    const opened = await AgentOsMcpSession.open(session);
    try {
      return await handler(opened);
    } finally {
      await opened.close();
    }
  };

  // Proactively refresh a session whose token is already past expiry
  // instead of letting it ride until the server rejects it.
  if (
    typeof initial.expires_at === "number" &&
    initial.expires_at <= Date.now() &&
    initial.refresh_token
  ) {
    const refreshed = await refreshStoredSession();
    if (!refreshed) {
      throw new AgentOSError(
        "AUTHORIZATION_REQUIRED",
        "The Agent OS authorization expired. Connect the Agentic sub-account again."
      );
    }
    return attempt(refreshed);
  }

  try {
    return await attempt(initial);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    const refreshed = await refreshStoredSession();
    if (!refreshed) {
      throw new AgentOSError(
        "AUTHORIZATION_REQUIRED",
        "The Agent OS authorization expired. Connect the Agentic sub-account again."
      );
    }
    return await attempt(refreshed);
  }
}