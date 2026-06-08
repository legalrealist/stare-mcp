# stare-mcp

MCP server for exploratory federal case law search. One tool — `research(query, circuit?)` — that searches [CourtListener](https://www.courtlistener.com/) and sorts results by court level:

**SCOTUS > binding circuit > persuasive circuit > district**

## Limitations

This is a convenience layer over CourtListener's search API, not a legal research system. Important caveats:

- **Retrieval is not reliable.** Results come from keyword relevance ranking, then get sorted by court level. Controlling authority can be missed entirely if it doesn't score in the top 20 search results. The system cannot tell you what it didn't find.
- **No citator or negative treatment.** There is no check for whether a case has been overruled, distinguished, or superseded. A returned "holding" may be bad law.
- **Section labels are heuristic.** "Holding" and "analysis" labels use regex pattern matching on structural headers and transition phrases. They are frequently wrong. Verify against the full opinion before citing.
- **No recall measurement.** There is no benchmark of queries and expected authorities. Output quality is untested beyond "does it return plausible-looking results."

Use this for exploratory research — finding starting points, not establishing the state of the law.

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
Returns results sorted by court level: SCOTUS first, then 9th Circuit, then other circuits, then district courts. Fragments are labeled heuristically as holding, analysis, etc.

**Fetch a specific opinion by citation:**
```
research("511 U.S. 825")
```
Returns Farmer v. Brennan with heuristically labeled sections (capped at 30 fragments).

## How it works

1. Detects whether query is a citation or a search (via [eyecite-ts](https://github.com/freelawproject/eyecite))
2. Searches CourtListener for published/precedential federal opinions
3. Sorts results by court level relative to your circuit
4. Fetches top 1-2 opinions per tier in parallel
5. Chunks opinions into paragraphs, applies heuristic section labels
6. Returns holding/analysis fragments, grouped by court level

## Valid circuit values

`ca1` `ca2` `ca3` `ca4` `ca5` `ca6` `ca7` `ca8` `ca9` `ca10` `ca11` `cadc` `cafc`

Omit `circuit` to get all results as persuasive authority (no binding tier).

## Development

```bash
npm test              # run tests (52 tests across 7 files)
npm run test:watch    # watch mode
node lib/server.js --help
```

Court hierarchy data is sourced from [Free Law Project's courts-db](https://github.com/freelawproject/courts-db) (BSD 2-Clause). To rebuild:

```bash
node scripts/build-courts.js
```

## License

MIT
