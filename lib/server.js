#!/usr/bin/env node

const flag = process.argv[2];
if (flag === "--help" || flag === "-h") {
  console.log(`stare-mcp v0.2.0 — Exploratory federal case law search

Usage: Set as an MCP server (stdio transport). Not meant to be run directly.

Tools:
  search_cases     Search federal opinions or look up a citation. Returns metadata only.
  fetch_passages   Retrieve paragraph-aligned text from a specific opinion.

  Configure in .mcp.json:
    { "mcpServers": { "stare": { "command": "node", "args": ["lib/server.js"],
      "env": { "COURTLISTENER_API_KEY": "<your-key>" } } } }

Environment:
  COURTLISTENER_API_KEY   CourtListener API token (required)
  CL_API_TOKEN            Alternative env var for the token`);
  process.exit(0);
}
if (flag === "--version" || flag === "-v") {
  console.log("0.2.0");
  process.exit(0);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isCitation } from "./citations.js";
import { searchCases, lookupCitation, listOpinions, fetchOpinionText } from "./courtlistener.js";
import { getTier, rankByAuthority, validateCircuit } from "./authority.js";
import { chunk } from "./chunker.js";
import { makeError } from "./errors.js";
import { successEnvelope, errorEnvelope, fragmentId } from "./envelope.js";
import { wrapCursor, unwrapCursor } from "./cursor.js";
import { resolveOpinionSelection } from "./opinion-selection.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);

const CL_TOKEN = process.env.COURTLISTENER_API_KEY || process.env.CL_API_TOKEN;

function jsonResponse(envelope) {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError: !!envelope.error,
  };
}

function requireToken() {
  if (!CL_TOKEN) {
    return errorEnvelope(
      makeError("no_api_key", "No CourtListener API key. Set COURTLISTENER_API_KEY environment variable."),
      {}
    );
  }
  return null;
}

const server = new McpServer({
  name: "stare",
  version: "0.2.0",
});

// --- search_cases ---

server.tool(
  "search_cases",
  "Search federal case law or look up a citation. Returns case metadata sorted by court level (SCOTUS > circuit > district). No opinion text — use fetch_passages to retrieve text for a specific opinion. Limitations: results depend on CourtListener keyword relevance; controlling authority may not appear in the result window.",
  {
    query: z.string().describe("Legal question or federal case citation"),
    circuit: z.string().optional().describe("Federal circuit for authority tier labeling, e.g. 'ca9'"),
    cursor: z.string().optional().describe("Pagination cursor from a previous search_cases response"),
  },
  async ({ query, circuit, cursor }) => {
    const tokenErr = requireToken();
    if (tokenErr) return jsonResponse(tokenErr);

    const circuitErr = validateCircuit(circuit);
    if (circuitErr) {
      return jsonResponse(
        errorEnvelope(makeError("invalid_circuit", circuitErr), { query })
      );
    }

    // Unwrap bound cursor if present
    let clCursor = null;
    if (cursor) {
      const unwrapped = unwrapCursor(cursor, query, circuit);
      if (unwrapped.error) {
        return jsonResponse(
          errorEnvelope(makeError(unwrapped.error, unwrapped.message), { query })
        );
      }
      clCursor = unwrapped.clCursor;
    }

    try {
      // Citation path (only on first page — cursor means we're paginating a search)
      if (!clCursor && isCitation(query)) {
        const citResult = await lookupCitation(query, CL_TOKEN);
        if (citResult.error) {
          return jsonResponse(errorEnvelope(citResult.error, { query }));
        }

        if (citResult.clusters.length === 0) {
          return jsonResponse(
            errorEnvelope(makeError("not_found", `Citation "${query}" not found in CourtListener.`), { query })
          );
        }

        // For each cluster, fetch opinion list
        // Note: this can be expensive (1 cluster + N sub-opinion requests per cluster)
        const cases = [];
        for (const c of citResult.clusters) {
          const opResult = await listOpinions(c.id, CL_TOKEN);
          const entry = {
            cluster_id: c.id,
            case_name: c.case_name,
            citation: c.citation_matched || null,
            court_id: null, // CL citation-lookup doesn't return court_id
            date_filed: c.date_filed,
            source_url: `https://www.courtlistener.com/opinion/${c.id}/`,
          };

          if (opResult.error) {
            entry.opinions = [];
            entry.opinions_error = opResult.error.code;
          } else {
            entry.opinions = opResult.opinions;
          }

          cases.push(entry);
        }

        return jsonResponse(
          successEnvelope(cases, { query, result_window: cases.length })
        );
      }

      // Search path
      const searchResult = await searchCases(query, CL_TOKEN, { cursor: clCursor });
      if (searchResult.error) {
        return jsonResponse(errorEnvelope(searchResult.error, { query }));
      }

      // Attach authority tier to each result
      const cases = searchResult.cases.map((c) => ({
        ...c,
        tier: getTier(c.court_id, circuit),
        court_name: courts[c.court_id]?.name || c.court_id,
      }));

      // Sort by tier then date
      const sorted = rankByAuthority(cases, circuit);

      const boundCursor = wrapCursor(searchResult.next_cursor, query, circuit);
      const pagination = boundCursor
        ? { next_cursor: boundCursor, has_more: true }
        : { next_cursor: null, has_more: false };

      return jsonResponse(
        successEnvelope(sorted, { query, result_window: sorted.length }, pagination)
      );
    } catch (err) {
      return jsonResponse(
        errorEnvelope(
          makeError("upstream_unavailable", err.message, true),
          { query }
        )
      );
    }
  }
);

// --- fetch_passages ---

server.tool(
  "fetch_passages",
  "Retrieve paragraph-aligned text from a specific opinion. Pass opinion_id for direct retrieval, or cluster_id to auto-select the lead opinion (returns selection_required with available opinions if ambiguous). Returns retrieval fragment IDs (cl:{opinion_id}:p{index}) for referencing passages — these are position-based, not judicial paragraph citations. No heuristic labels — text is returned as-is.",
  {
    opinion_id: z.number().optional().describe("Opinion ID — direct retrieval (preferred)"),
    cluster_id: z.number().optional().describe("Cluster ID — resolves to lead opinion, or returns selection_required if ambiguous"),
    cursor: z.string().optional().describe("Pagination cursor (e.g. 'p30') from a previous fetch_passages response"),
  },
  async ({ opinion_id, cluster_id, cursor }) => {
    const tokenErr = requireToken();
    if (tokenErr) return jsonResponse(tokenErr);

    // Validate: need at least one of opinion_id or cluster_id
    if (!opinion_id && !cluster_id) {
      return jsonResponse(
        errorEnvelope(
          makeError("invalid_opinion_id", "Provide either opinion_id or cluster_id."),
          {}
        )
      );
    }

    // If cluster_id provided without opinion_id, resolve it
    let resolvedOpinionId = opinion_id;
    if (!resolvedOpinionId && cluster_id) {
      try {
        const opList = await listOpinions(cluster_id, CL_TOKEN);
        if (opList.error) {
          return jsonResponse(errorEnvelope(opList.error, { cluster_id }));
        }

        const selection = resolveOpinionSelection(opList, cluster_id);
        if (selection.error) {
          return jsonResponse(errorEnvelope(selection.error, { cluster_id }));
        }
        resolvedOpinionId = selection.opinionId;
      } catch (err) {
        return jsonResponse(
          errorEnvelope(
            makeError("upstream_unavailable", err.message, true),
            { cluster_id }
          )
        );
      }
    }

    if (!Number.isInteger(resolvedOpinionId) || resolvedOpinionId <= 0) {
      return jsonResponse(
        errorEnvelope(
          makeError("invalid_opinion_id", `opinion_id must be a positive integer, got: ${resolvedOpinionId}`),
          { opinion_id: resolvedOpinionId }
        )
      );
    }

    const PAGE_SIZE = 30;
    let startIndex = 0;
    if (cursor) {
      if (!/^p\d+$/.test(cursor)) {
        return jsonResponse(
          errorEnvelope(
            makeError("invalid_cursor", `Invalid cursor: "${cursor}". Expected format: p{number}, e.g. "p30".`),
            { opinion_id: resolvedOpinionId }
          )
        );
      }
      startIndex = parseInt(cursor.slice(1), 10);
    }

    try {
      const result = await fetchOpinionText(resolvedOpinionId, CL_TOKEN);
      if (result.error) {
        return jsonResponse(errorEnvelope(result.error, { opinion_id: resolvedOpinionId }));
      }

      if (!result.text || !result.text.trim()) {
        return jsonResponse(
          errorEnvelope(
            makeError("content_unavailable", `Opinion ${resolvedOpinionId} has no extractable text (neither plain text nor usable HTML).`),
            { opinion_id: resolvedOpinionId }
          )
        );
      }

      const paragraphs = chunk(result.text);

      const page = paragraphs.slice(startIndex, startIndex + PAGE_SIZE);
      const hasMore = startIndex + PAGE_SIZE < paragraphs.length;

      const fragments = page.map((p) => ({
        fragment_id: fragmentId(resolvedOpinionId, p.index),
        paragraph: p.index,
        text: p.text,
      }));

      const pagination = hasMore
        ? { next_cursor: `p${startIndex + PAGE_SIZE}`, has_more: true }
        : { next_cursor: null, has_more: false };

      return jsonResponse(
        successEnvelope(
          {
            opinion_id: resolvedOpinionId,
            type: result.type,
            author: result.author,
            total_paragraphs: paragraphs.length,
            fragments,
          },
          { opinion_id: resolvedOpinionId, result_window: fragments.length },
          pagination
        )
      );
    } catch (err) {
      return jsonResponse(
        errorEnvelope(
          makeError("upstream_unavailable", err.message, true),
          { opinion_id: resolvedOpinionId }
        )
      );
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
