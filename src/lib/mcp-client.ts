/**
 * Long-lived MCP client that owns the stdio child-process transport
 * connecting the Hono HTTP server to the bundled `mcp-server.ts`.
 *
 * Mirrors the pattern used by Claude Desktop and the reference
 * stdio-mcp/web-server.js bridge: the browser never speaks MCP directly;
 * the HTTP layer is the MCP client.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import type { Decade, Quote } from "./decades.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MCP_SERVER_PATH = path.resolve(__dirname, "..", "mcp-server.ts");

export interface McpServerInfo {
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd: string;
  sourceFile: string;
  serverInfo: { name: string; version: string } | undefined;
  tools: Array<{ name: string; description?: string }>;
}

export interface McpClientHandle {
  serverInfo(): McpServerInfo;
  listDecades(): Promise<{ decades: Decade[]; quotesPerDecade: number }>;
  getQuotes(decade: Decade): Promise<{ decade: Decade; count: number; quotes: Quote[] }>;
  close(): Promise<void>;
}

interface ToolListEntry {
  name: string;
  description?: string;
}

interface McpTextContent {
  type: "text";
  text: string;
}

function extractJsonPayload<T>(content: unknown): T {
  if (!Array.isArray(content)) {
    throw new Error("MCP tool returned non-array content");
  }
  const first = content.find(
    (entry): entry is McpTextContent =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { type?: unknown }).type === "text" &&
      typeof (entry as { text?: unknown }).text === "string",
  );
  if (!first) {
    throw new Error("MCP tool returned no text content");
  }
  return JSON.parse(first.text) as T;
}

export async function connectMcpClient(): Promise<McpClientHandle> {
  const command = process.execPath;
  const tsxCli = path.resolve(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const args = [tsxCli, MCP_SERVER_PATH];

  const transport = new StdioClientTransport({
    command,
    args,
    cwd: PROJECT_ROOT,
    stderr: "inherit",
  });

  const client = new Client(
    { name: "tech-movie-quotes-http-bridge", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolList: ToolListEntry[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));

  const callTool = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const result = await client.callTool({ name, arguments: args });
    return extractJsonPayload<T>(result.content);
  };

  return {
    serverInfo(): McpServerInfo {
      return {
        name: "tech-movie-quotes-mcp",
        transport: "stdio",
        command,
        args,
        cwd: PROJECT_ROOT,
        sourceFile: MCP_SERVER_PATH,
        serverInfo: client.getServerVersion(),
        tools: toolList,
      };
    },
    async listDecades() {
      return callTool<{ decades: Decade[]; quotesPerDecade: number }>("list_decades", {});
    },
    async getQuotes(decade) {
      return callTool<{ decade: Decade; count: number; quotes: Quote[] }>("get_quotes", {
        decade,
      });
    },
    async close() {
      try {
        await client.close();
      } catch {
        // already closed
      }
    },
  };
}
