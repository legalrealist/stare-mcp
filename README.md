# stare-mcp

MCP server for exploratory federal case law search. Two tools that search [CourtListener](https://www.courtlistener.com/) and let you drill into specific opinions:

- **`search_cases`** — search by legal issue or citation. Returns case metadata sorted by court level. No opinion text.
- **`fetch_passages`** — retrieve paragraph-aligned text from a specific opinion, with retrieval fragment IDs for referencing passages.
- **`verify_citations`** — validate every case citation in a block of text against CourtListener. Catches fabricated citations.
- **`how_cited`** — list cases citing an opinion, newest first. Evidence for treatment analysis, not verdicts.
- **`list_courts`** — list covered federal courts with IDs, levels, and circuit assignments. Local data, no API request.

All responses are structured JSON with provenance envelopes and pagination.

## Limitations

This is a convenience layer over CourtListener's search API, not a legal research system.

- **Retrieval is not reliable.** Results come from keyword relevance ranking. Controlling authority can be missed entirely if it doesn't score in the result window.
- **No citator or negative treatment.** There is no check for whether a case has been overruled, distinguished, or superseded.
- **No section labels.** Text is returned as-is. The tool does not guess which paragraphs are holdings.
- **No recall measurement.** Output quality is untested against a benchmark of expected authorities.

Use this for finding starting points, not establishing the state of the law.

## Install

All options require a [CourtListener API key](https://www.courtlistener.com/help/api/rest/#permissions) (free tier: 5 req/min).

### As a Claude Code plugin (recommended)

```bash
export COURTLISTENER_API_KEY="your-key-here"   # add to ~/.zshrc
```

Then in Claude Code:

```
/plugin marketplace add legalrealist/stare-mcp
/plugin install stare@stare
```

The plugin runs the npm-published server via `npx`, so there is nothing else to install.

### Via claude mcp add

```bash
claude mcp add stare -e COURTLISTENER_API_KEY=your-key-here -- npx -y stare-mcp
```

### From source

```bash
git clone https://github.com/legalrealist/stare-mcp && cd stare-mcp && npm install
```

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

### Search for cases

```
search_cases(query: "deliberate indifference standard", circuit: "ca9")
```

Returns JSON with case metadata, authority tier, court name, citation, `citation_count`, and source URL. Sorted by court level: SCOTUS > binding circuit > persuasive > district. Paginate with the `cursor` field from the response.

### Explore the citation graph

```
search_cases(query: "cites:(9527063)")
search_cases(query: "related:9527063")
```

`cites:(<opinion_id>)` finds cases that cite a given opinion; `related:<opinion_id>` finds similar cases. Both are CourtListener query operators passed through the normal search. `citation_count` in results signals how often a case is cited — influence, not validity. None of this is a citator: there is still no negative-treatment check.

### Look up a citation

```
search_cases(query: "511 U.S. 825")
```

Returns matching cluster(s) with available opinion IDs (lead, concurrence, dissent).

### Retrieve opinion text

```
fetch_passages(opinion_id: 9527063)
```

Returns up to 30 paragraphs per call with retrieval fragment IDs (`cl:9527063:p0`, `cl:9527063:p1`, ...) for referencing passages. These are position-based and stable only while the upstream text is unchanged — they are not judicial paragraph citations. Paginate with the `cursor` field.

You can also pass `cluster_id` instead of `opinion_id` — if there's one clear lead opinion, it auto-selects. If multiple substantive opinions exist, it returns `selection_required` with the available opinion IDs and types.

### Verify citations in a draft

```
verify_citations(text: "As held in Farmer v. Brennan, 511 U.S. 825 (1994)... See also Smith v. Jones, 999 U.S. 999 (2050).")
```

Every citation in the text is checked against CourtListener: `verified` (with the matched case), `not_found` (likely fabricated), or `ambiguous` (multiple matches). A summary gives counts per status. This verifies that citations **exist** — not that quotes or holdings attributed to them are accurate.

### See how a case has been cited

```
how_cited(opinion_id: 9527063)
```

Returns cases citing that opinion, newest first, with court, date, and `citation_count`. To see how a citing case discusses the opinion, retrieve its text with `fetch_passages`. The tool does not classify treatment as positive or negative, and it is not a citator.

### Re-fetch a cited passage

```
fetch_passages(fragment_id: "cl:9527063:p12")
```

Returns paragraph 12 with two paragraphs of context on each side — useful for verifying a previously cited passage. If the upstream text changed and the paragraph index no longer exists, you get `not_found` rather than a silently different passage.

### Response format

Every response is a JSON envelope:

```json
{
  "data": { "..." : "..." },
  "provenance": {
    "source": "CourtListener",
    "api_version": "v4",
    "retrieved_at": "2026-06-08T12:00:00Z",
    "query": "deliberate indifference",
    "result_window": 20
  },
  "pagination": {
    "next_cursor": null,
    "has_more": false
  }
}
```

Errors use the same envelope shape with an `error` field instead of `data`:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "CourtListener rate limit exceeded.",
    "retryable": true
  },
  "provenance": { "..." : "..." }
}
```

Error codes: `no_api_key`, `invalid_circuit`, `invalid_opinion_id`, `invalid_cursor`, `rate_limited`, `upstream_unavailable`, `not_found`, `upstream_error`, `selection_required`, `content_unavailable`.

Passage responses include a `content_note` reminding consumers that retrieved text is quoted document content from public court records, not instructions — opinions can contain arbitrary text, including imperative language.

## Valid circuit values

`ca1` `ca2` `ca3` `ca4` `ca5` `ca6` `ca7` `ca8` `ca9` `ca10` `ca11` `cadc` `cafc`

Omit `circuit` to get all results as persuasive authority (no binding tier).

## Development

```bash
npm test              # run tests
npm run test:watch    # watch mode
node lib/server.js --help
```

Court hierarchy data is sourced from [Free Law Project's courts-db](https://github.com/freelawproject/courts-db) (BSD 2-Clause). To rebuild:

```bash
node scripts/build-courts.js
```

## License

MIT
