#!/usr/bin/env tsx
/**
 * Stdio MCP server for the tech-movie-quotes catalog.
 *
 * Exposes three read-only tools backed by `data/quotes.json`:
 *   - list_decades:    available decade keys
 *   - get_quotes:      all quotes for a decade
 *   - get_quote_count: number of quotes for a decade
 *
 * The Hono HTTP server in `src/server.ts` spawns this file as a child
 * process and talks to it over MCP stdio. Run directly to use it from
 * the MCP Inspector:
 *
 *   npx @modelcontextprotocol/inspector tsx src/mcp-server.ts
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { DECADES, decadeSchema, type Decade, type Quote } from "./lib/decades.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUOTES_PATH = path.resolve(__dirname, "..", "data", "quotes.json");

type Catalog = Record<Decade, Quote[]>;

async function loadCatalog(): Promise<Catalog> {
  const raw = await readFile(QUOTES_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<Record<Decade, Quote[]>>;
  const catalog = {} as Catalog;
  for (const decade of DECADES) {
    const entries = parsed[decade];
    if (!Array.isArray(entries)) {
      throw new Error(`Missing or invalid quotes for decade "${decade}" in ${QUOTES_PATH}`);
    }
    catalog[decade] = entries;
  }
  return catalog;
}

const catalog = await loadCatalog();

const server = new McpServer(
  { name: "tech-movie-quotes-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const textResult = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

server.registerTool(
  "list_decades",
  {
    title: "List decades",
    description: "Return the list of decade keys this catalog covers.",
    inputSchema: {},
  },
  async () => textResult({ decades: DECADES, quotesPerDecade: catalog["80s"].length }),
);

server.registerTool(
  "get_quotes",
  {
    title: "Get quotes",
    description: "Return all quotes for a given decade.",
    inputSchema: {
      decade: decadeSchema.describe(`One of: ${DECADES.join(", ")}`),
    },
  },
  async ({ decade }) => {
    const quotes = catalog[decade];
    return textResult({ decade, count: quotes.length, quotes });
  },
);

server.registerTool(
  "get_quote_count",
  {
    title: "Get quote count",
    description: "Return how many quotes are available for a decade.",
    inputSchema: {
      decade: decadeSchema.describe(`One of: ${DECADES.join(", ")}`),
    },
  },
  async ({ decade }) => textResult({ decade, count: catalog[decade].length }),
);

// Guarded against `z` being tree-shaken on platforms that aggressively prune
// unused imports — zod is used implicitly through `decadeSchema` and `z.enum`.
void z;

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
  `[tech-movie-quotes-mcp] connected over stdio (${DECADES.length} decades, ${
    catalog["80s"].length
  } quotes per decade)\n`,
);
