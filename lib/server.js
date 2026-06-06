#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isCitation } from "./citations.js";
import { searchOpinions, fetchOpinion, lookupCitation } from "./courtlistener.js";
import { getTier, rankByAuthority } from "./authority.js";
import { chunk } from "./chunker.js";
import { labelSections } from "./sectioner.js";
import { filterFragments, assembleResponse } from "./response.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);

const TIER_LABELS = {
  1: "Controlling Authority",
  2: (circuit) => `Binding Circuit Authority (${courts[circuit]?.name || circuit})`,
  3: "Persuasive Authority (Other Circuits)",
  4: "District Court Authority",
  5: "Other",
};

function tierLabel(tier, circuit) {
  const label = TIER_LABELS[tier];
  return typeof label === "function" ? label(circuit) : label;
}

const CL_TOKEN = process.env.COURTLISTENER_API_KEY || process.env.CL_API_TOKEN;

async function processOpinion(clusterId, token) {
  const opinion = await fetchOpinion(clusterId, token);
  if (!opinion?.text) return null;
  const paragraphs = chunk(opinion.text);
  return labelSections(paragraphs);
}

async function handleSearch(query, circuit, token) {
  const results = await searchOpinions(query, token);
  if (results.length === 0) return [];

  const ranked = rankByAuthority(results, circuit);

  // Pick top 1-2 per represented tier
  const picks = [];
  const tierCounts = new Map();
  for (const r of ranked) {
    const count = tierCounts.get(r.tier) || 0;
    if (count < 2) {
      picks.push(r);
      tierCounts.set(r.tier, count + 1);
    }
  }

  // Fetch opinions in parallel
  const opinions = await Promise.all(
    picks.map(async (r) => {
      try {
        const allFragments = await processOpinion(r.cluster_id, token);
        if (!allFragments) {
          return {
            tier: r.tier,
            tierLabel: tierLabel(r.tier, circuit),
            case_name: r.case_name,
            citation: r.citation,
            court_name: courts[r.court_id]?.name || r.court_id,
            date_filed: r.date_filed,
            fragments: [{ section: "error", text: "(opinion text not available)" }],
            totalFragments: 0,
          };
        }
        const { kept, droppedCount } = filterFragments(allFragments);
        return {
          tier: r.tier,
          tierLabel: tierLabel(r.tier, circuit),
          case_name: r.case_name,
          citation: r.citation,
          court_name: courts[r.court_id]?.name || r.court_id,
          date_filed: r.date_filed,
          fragments: kept.length > 0 ? kept : [{ section: "unlabeled", text: allFragments[0]?.text || "(no content)" }],
          totalFragments: allFragments.length,
        };
      } catch (err) {
        return {
          tier: r.tier,
          tierLabel: tierLabel(r.tier, circuit),
          case_name: r.case_name,
          citation: r.citation,
          court_name: courts[r.court_id]?.name || r.court_id,
          date_filed: r.date_filed,
          fragments: [{ section: "error", text: `(fetch failed: ${err.message})` }],
          totalFragments: 0,
        };
      }
    })
  );

  return opinions;
}

async function handleCitation(query, token) {
  const matches = await lookupCitation(query, token);
  if (matches.length === 0) return null;

  const match = matches[0];
  const clusterId = match.id;
  const allFragments = await processOpinion(clusterId, token);

  if (!allFragments) {
    return {
      content: [{ type: "text", text: `[FAILED] Opinion for ${query} could not be retrieved.` }],
      isError: true,
    };
  }

  const lines = [];
  lines.push(`# ${match.case_name || query}\n`);
  lines.push(`**Citation:** ${query} · **Decided:** ${match.date_filed || "unknown"}\n`);

  let currentSection = null;
  for (const f of allFragments) {
    if (f.section !== currentSection) {
      currentSection = f.section;
      lines.push(`\n### ${currentSection.replace(/_/g, " ")}\n`);
    }
    lines.push(`> ${f.text}\n`);
  }

  lines.push(`\n*${allFragments.length} fragments from full opinion.*`);
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

const server = new McpServer({
  name: "stare",
  version: "0.1.0",
});

server.tool(
  "research",
  "Search federal case law and return results organized by court authority hierarchy (SCOTUS > binding circuit > persuasive > district). Pass a legal question to search, or a citation (e.g. '511 U.S. 825') to fetch a specific opinion.",
  {
    query: z.string().describe("Legal question or federal case citation"),
    circuit: z.string().optional().describe("Federal circuit for authority ranking, e.g. 'ca9' for 9th Circuit"),
  },
  async ({ query, circuit }) => {
    const token = CL_TOKEN;
    if (!token) {
      return {
        content: [{ type: "text", text: "[ERROR] No CourtListener API key. Set COURTLISTENER_API_KEY environment variable." }],
        isError: true,
      };
    }

    try {
      if (isCitation(query)) {
        const result = await handleCitation(query, token);
        if (result) return result;
        return {
          content: [{ type: "text", text: `[NO_AUTHORITY_FOUND] Citation "${query}" not found in CourtListener.` }],
          isError: true,
        };
      }

      const opinions = await handleSearch(query, circuit, token);
      if (opinions.length === 0) {
        return {
          content: [{ type: "text", text: `[NO_AUTHORITY_FOUND] No opinions found for "${query}". This means the search failed — not that no authority exists.` }],
          isError: true,
        };
      }

      const md = assembleResponse(opinions, { query, circuit });
      return { content: [{ type: "text", text: md }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `[ERROR] ${err.message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
