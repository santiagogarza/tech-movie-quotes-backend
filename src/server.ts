/**
 * Hono HTTP server that bridges the browser to the bundled stdio MCP server.
 *
 * Endpoints:
 *   GET /              - server identity + tool surface (handy for `curl`)
 *   GET /health        - liveness + MCP-connected status + catalog shape
 *   GET /quotes/:decade - all quotes for a decade (validated with zod)
 *   GET /mcp-info      - structural metadata about the spawned MCP server
 *
 * The MCP client connects on boot, lists tools once, and then this server
 * proxies HTTP requests to MCP tool calls. The browser never talks MCP.
 */
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { decadeSchema, isDecade } from "./lib/decades.ts";
import { connectMcpClient } from "./lib/mcp-client.ts";

const PORT = Number(process.env.PORT ?? 8787);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const mcp = await connectMcpClient();
const { decades, quotesPerDecade } = await mcp.listDecades();
console.log(
  `[tech-movie-quotes-backend] MCP connected; ${decades.length} decades, ${quotesPerDecade} quotes per decade`,
);

const app = new Hono();
app.use("*", cors({ origin: CORS_ORIGIN }));

app.get("/", (c) =>
  c.json({
    name: "tech-movie-quotes-backend",
    version: "0.1.0",
    mcp: "connected",
    endpoints: ["/health", "/quotes/:decade", "/mcp-info"],
    decades,
    quotesPerDecade,
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    mcp: "connected",
    decades,
    quotesPerDecade,
  }),
);

app.get("/quotes/:decade", async (c) => {
  const raw = c.req.param("decade");
  if (!isDecade(raw)) {
    return c.json(
      {
        error: "invalid_decade",
        message: `Unknown decade "${raw}". Valid values: ${decades.join(", ")}.`,
        decades,
      },
      400,
    );
  }
  const parsed = decadeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid_decade", issues: parsed.error.issues }, 400);
  }
  try {
    const payload = await mcp.getQuotes(parsed.data);
    return c.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "mcp_error", message }, 502);
  }
});

app.get("/mcp-info", async (c) => {
  const info = mcp.serverInfo();
  let sourcePreview: string | undefined;
  try {
    const source = await readFile(info.sourceFile, "utf8");
    sourcePreview = source.length > 4096 ? source.slice(0, 4096) + "\n// ...truncated" : source;
  } catch {
    sourcePreview = undefined;
  }
  return c.json({ ...info, sourcePreview });
});

const server = serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
  console.log(`[tech-movie-quotes-backend] listening on http://localhost:${port}`);
});

const shutdown = async (signal: string) => {
  console.log(`\n[tech-movie-quotes-backend] received ${signal}, shutting down...`);
  server.close();
  await mcp.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
