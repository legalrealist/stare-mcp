# stare-mcp

MCP server for federal case law research. One tool — `research(query, circuit?)` — that searches [CourtListener](https://www.courtlistener.com/) and returns results organized by court authority hierarchy:

**SCOTUS > binding circuit > persuasive circuit > district**

Most legal search tools return flat result lists. Stare returns a structured research memo with holdings and analysis, ranked by how much the court's opinion actually matters to your jurisdiction.

## Setup

```bash
npm install
```

Get a [CourtListener API key](https://www.courtlistener.com/help/api/rest/#permissions) (free tier: 5 req/min).

Add to your MCP client config (Claude Code, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "stare": {
      "command": "node",
      "args": ["/path/to/stare-mcp/lib/server.js"],
      "env": {
        "COURTLISTENER_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Usage

**Search by legal issue:**
```
research("deliberate indifference standard", circuit: "ca9")
```
Returns tiered markdown: SCOTUS holdings first, then 9th Circuit binding authority, then persuasive authority from other circuits, then district courts.

**Fetch a specific opinion by citation:**
```
research("511 U.S. 825")
```
Returns the full opinion (Farmer v. Brennan) with sections labeled — holding, analysis, facts, etc.

## How it works

1. Detects whether query is a citation or a search (via [eyecite-ts](https://github.com/freelawproject/eyecite))
2. Searches CourtListener's federal opinion corpus
3. Ranks results by authority tier relative to your circuit
4. Fetches top 1-2 opinions per tier in parallel
5. Chunks opinions into paragraphs, labels sections heuristically (structural headers + transition phrases)
6. Returns only holding/analysis fragments, organized by tier

## Valid circuit values

`ca1` `ca2` `ca3` `ca4` `ca5` `ca6` `ca7` `ca8` `ca9` `ca10` `ca11` `cadc` `cafc`

Omit `circuit` to get all results as persuasive authority (no binding tier).

## Development

```bash
npm test              # run tests (51 tests across 7 files)
npm run test:watch    # watch mode
node lib/server.js --help
```

Court hierarchy data is sourced from [Free Law Project's courts-db](https://github.com/freelawproject/courts-db) (BSD 2-Clause). To rebuild:

```bash
node scripts/build-courts.js
```

## License

MIT
