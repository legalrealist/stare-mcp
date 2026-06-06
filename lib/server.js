#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "stare",
  version: "0.1.0",
});

server.tool(
  "research",
  "Search federal case law and return results organized by court authority hierarchy. Pass a legal question to search, or a citation (e.g. '511 U.S. 825') to fetch a specific opinion.",
  {
    query: z.string().describe("Legal question or case citation"),
    circuit: z.string().optional().describe("Federal circuit for authority ranking, e.g. 'ca9'"),
  },
  async ({ query, circuit }) => {
    return {
      content: [{ type: "text", text: "TODO: implement research" }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
