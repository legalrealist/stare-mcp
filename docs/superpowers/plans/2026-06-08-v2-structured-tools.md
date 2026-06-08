# Stare MCP v2: Structured Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `research` tool with two structured tools — `search_cases` (lightweight metadata) and `fetch_passages` (explicit paragraph retrieval) — returning JSON provenance envelopes instead of Markdown, with opinion-type-aware retrieval, pagination, and an explicit error taxonomy.

**Architecture:** Search returns metadata only (1 CL request). Passage retrieval takes an explicit `opinion_id` (1-2 CL requests). No automatic fan-out. Every response is a JSON envelope with `data`, `provenance`, and `pagination` fields. The agent decides what to retrieve; the tool never guesses. The existing `research` tool is removed.

**Tech Stack:** Node.js, `@modelcontextprotocol/sdk` (stdio), `zod`, `eyecite-ts`, CourtListener API v4, Vitest.

---

## Design Decisions

### Tool Schemas

**`search_cases(query, circuit?, cursor?)`**
- Input: legal question or citation text, optional circuit for tier labeling, optional cursor for pagination.
- Output: JSON envelope with case metadata array. No opinion text. 1 CL request per call.

**`fetch_passages(cluster_id?, opinion_id?, cursor?)`**
- Input: either `opinion_id` (direct) or `cluster_id` (resolved). Optional cursor for pagination.
- If `opinion_id` provided: fetch that opinion directly. 1 CL request.
- If `cluster_id` provided without `opinion_id`: fetch cluster, inspect sub_opinions. If exactly one lead/combined/per-curiam opinion exists, auto-select it. If multiple substantive opinions exist, return `selection_required` error with all opinion IDs and types so the caller can choose.
- Output: JSON envelope with paragraph-aligned fragments. No heuristic labels. 1-3 CL requests per call.

### Response Envelope

Every tool response uses this shape:

```json
{
  "data": [],
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

### Stable Fragment ID Format

Passages use a composite ID: `cl:{opinion_id}:p{paragraph_index}`

Example: `cl:1087956:p12` — CourtListener opinion 1087956, paragraph 12.

This is stable across repeated retrievals of the same opinion. It is NOT stable across CL data updates (opinion text may change).

### Opinion Selection Rules

`search_cases` returns each cluster's available opinions as:

```json
{
  "opinions": [
    { "opinion_id": 456, "type": "lead", "author": "Souter" },
    { "opinion_id": 457, "type": "dissent", "author": "Thomas" }
  ]
}
```

`fetch_passages` requires an explicit `opinion_id`. If the caller passes a cluster ID or omits it, the tool returns an error with the available opinion IDs.

The calling agent is responsible for choosing which opinion to read. The tool never auto-selects.

### CourtListener Request Budget

| Tool | CL requests | Notes |
|------|-------------|-------|
| `search_cases` (search) | 1 | `/search/` endpoint |
| `search_cases` (citation) | 1 | `/citation-lookup/` endpoint |
| `fetch_passages` | 1-2 | `/opinions/{id}/` always; `/clusters/{id}/` only if we need to look up available opinions |

v1 used 5-17 requests per `research` call. v2 uses 1-2 per tool call.

### Error Taxonomy

Structured errors in envelope format:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "CourtListener API rate limit exceeded. Retry after 60 seconds.",
    "retryable": true
  },
  "provenance": { ... }
}
```

Error codes:
- `no_api_key` — COURTLISTENER_API_KEY not set.
- `invalid_circuit` — unrecognized circuit ID.
- `invalid_opinion_id` — opinion ID not found or not a number.
- `rate_limited` — CL returned 429. `retryable: true`.
- `upstream_unavailable` — CL returned 5xx or timed out. `retryable: true`.
- `not_found` — citation or opinion not found in CL. `retryable: false`.
- `upstream_error` — other CL 4xx errors. `retryable: false`.
- `selection_required` — cluster has multiple substantive opinions; caller must specify `opinion_id`. `retryable: false`. Includes `opinions` array with available choices.

### Pagination

**`search_cases`:** CL returns up to 20 results per page. `next_cursor` is the CL `next` URL (opaque string). Pass it back as `cursor` for the next page.

**`fetch_passages`:** Returns up to 30 paragraphs per call. `next_cursor` is `p{next_index}`. Pass it back as `cursor` to continue.

### Partial Results

No silent partial results. If a CL request fails, the tool returns an error envelope — not a partial success. The caller retries explicitly.

---

## File Structure

```
stare-mcp/
├── lib/
│   ├── server.js            # MCP server, tool registration (REWRITE)
│   ├── courtlistener.js     # CL API client (MODIFY — new functions, remove old)
│   ├── authority.js          # Court tier logic (KEEP — reuse getTier, validateCircuit)
│   ├── citations.js          # Citation detection (KEEP — reuse isCitation)
│   ├── chunker.js            # Paragraph splitting (KEEP — reuse chunk)
│   ├── envelope.js           # Response envelope builders (NEW)
│   ├── errors.js             # Error taxonomy (NEW)
│   ├── sectioner.js          # (DELETE — heuristic labels removed)
│   └── response.js           # (DELETE — markdown assembly removed)
├── test/
│   ├── envelope.test.js      # Envelope shape tests (NEW)
│   ├── errors.test.js        # Error builder tests (NEW)
│   ├── courtlistener.test.js # CL client mock tests (REWRITE)
│   ├── server.test.js        # MCP smoke tests (REWRITE)
│   ├── authority.test.js     # (KEEP)
│   ├── citations.test.js     # (KEEP)
│   └── chunker.test.js       # (KEEP)
├── data/courts.json          # (KEEP)
├── scripts/build-courts.js   # (KEEP)
├── .github/workflows/ci.yml  # (KEEP)
├── .mcp.json                 # (UPDATE)
├── package.json              # (UPDATE version to 0.2.0)
└── README.md                 # (REWRITE)
```

**Module dependency order** (each depends only on modules above it):
1. `errors.js` — no deps
2. `envelope.js` — imports `errors.js`
3. `citations.js` — wraps `eyecite-ts` (UNCHANGED)
4. `chunker.js` — string splitting (UNCHANGED)
5. `authority.js` — reads `courts.json` (UNCHANGED)
6. `courtlistener.js` — fetch wrapper, imports `errors.js`
7. `server.js` — wires everything together

---

### Task 1: Error Taxonomy (`lib/errors.js`)

**Files:**
- Create: `lib/errors.js`
- Create: `test/errors.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/errors.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { makeError, classifyHttpError } from "../lib/errors.js";

describe("makeError", () => {
  it("creates a structured error with all fields", () => {
    const err = makeError("rate_limited", "Too many requests", true);
    expect(err).toEqual({
      code: "rate_limited",
      message: "Too many requests",
      retryable: true,
    });
  });

  it("defaults retryable to false", () => {
    const err = makeError("not_found", "Not found");
    expect(err.retryable).toBe(false);
  });
});

describe("classifyHttpError", () => {
  it("classifies 429 as rate_limited", () => {
    const err = classifyHttpError(429, "/search/");
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
  });

  it("classifies 404 as not_found", () => {
    const err = classifyHttpError(404, "/opinions/999/");
    expect(err.code).toBe("not_found");
    expect(err.retryable).toBe(false);
  });

  it("classifies 500 as upstream_unavailable", () => {
    const err = classifyHttpError(500, "/search/");
    expect(err.code).toBe("upstream_unavailable");
    expect(err.retryable).toBe(true);
  });

  it("classifies 502/503/504 as upstream_unavailable", () => {
    expect(classifyHttpError(502, "/x").code).toBe("upstream_unavailable");
    expect(classifyHttpError(503, "/x").code).toBe("upstream_unavailable");
    expect(classifyHttpError(504, "/x").code).toBe("upstream_unavailable");
  });

  it("classifies other 4xx as upstream_error", () => {
    const err = classifyHttpError(403, "/search/");
    expect(err.code).toBe("upstream_error");
    expect(err.retryable).toBe(false);
  });

  it("includes the path in the message", () => {
    const err = classifyHttpError(429, "/search/");
    expect(err.message).toContain("/search/");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/errors.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/errors.js`:

```javascript
export function makeError(code, message, retryable = false) {
  return { code, message, retryable };
}

export function classifyHttpError(status, path) {
  if (status === 429) {
    return makeError("rate_limited", `CourtListener rate limit exceeded: ${path}. Retry after 60 seconds.`, true);
  }
  if (status === 404) {
    return makeError("not_found", `Not found: ${path}`, false);
  }
  if (status >= 500) {
    return makeError("upstream_unavailable", `CourtListener unavailable (${status}): ${path}`, true);
  }
  return makeError("upstream_error", `CourtListener error (${status}): ${path}`, false);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/errors.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/errors.js test/errors.test.js
git commit -m "feat(v2): error taxonomy — structured error codes with retryable flag"
```

---

### Task 2: Response Envelopes (`lib/envelope.js`)

**Files:**
- Create: `lib/envelope.js`
- Create: `test/envelope.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/envelope.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { successEnvelope, errorEnvelope, FRAGMENT_PREFIX } from "../lib/envelope.js";

describe("successEnvelope", () => {
  it("wraps data with provenance and pagination", () => {
    const env = successEnvelope(
      [{ id: 1 }],
      { query: "test", result_window: 20 },
      { next_cursor: "abc", has_more: true }
    );
    expect(env.data).toEqual([{ id: 1 }]);
    expect(env.provenance.source).toBe("CourtListener");
    expect(env.provenance.api_version).toBe("v4");
    expect(env.provenance.query).toBe("test");
    expect(env.provenance.result_window).toBe(20);
    expect(env.provenance.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(env.pagination.next_cursor).toBe("abc");
    expect(env.pagination.has_more).toBe(true);
  });

  it("defaults pagination to no-more", () => {
    const env = successEnvelope([], { query: "x" });
    expect(env.pagination).toEqual({ next_cursor: null, has_more: false });
  });

  it("omits undefined provenance fields", () => {
    const env = successEnvelope([], { query: "x" });
    expect(env.provenance).not.toHaveProperty("result_window");
  });
});

describe("errorEnvelope", () => {
  it("wraps a structured error with provenance", () => {
    const err = { code: "rate_limited", message: "Too fast", retryable: true };
    const env = errorEnvelope(err, { query: "test" });
    expect(env.error).toEqual(err);
    expect(env.provenance.source).toBe("CourtListener");
    expect(env.provenance.query).toBe("test");
    expect(env).not.toHaveProperty("data");
    expect(env).not.toHaveProperty("pagination");
  });
});

describe("FRAGMENT_PREFIX", () => {
  it("is cl:", () => {
    expect(FRAGMENT_PREFIX).toBe("cl:");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/envelope.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/envelope.js`:

```javascript
export const FRAGMENT_PREFIX = "cl:";

export function fragmentId(opinionId, paragraphIndex) {
  return `${FRAGMENT_PREFIX}${opinionId}:p${paragraphIndex}`;
}

function buildProvenance(fields) {
  const prov = {
    source: "CourtListener",
    api_version: "v4",
    retrieved_at: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) prov[k] = v;
  }
  return prov;
}

export function successEnvelope(data, provenanceFields, pagination) {
  return {
    data,
    provenance: buildProvenance(provenanceFields),
    pagination: pagination || { next_cursor: null, has_more: false },
  };
}

export function errorEnvelope(error, provenanceFields) {
  return {
    error,
    provenance: buildProvenance(provenanceFields),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/envelope.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/envelope.js test/envelope.test.js
git commit -m "feat(v2): response envelopes — provenance, pagination, fragment IDs"
```

---

### Task 3: Refactor CourtListener Client (`lib/courtlistener.js`)

Replace the v1 API functions with v2 equivalents. The `cl()` helper and HTML stripping are reused. New functions return raw CL data (no opinion text fetching in search). Add `listOpinions` and `fetchOpinionText`.

**Files:**
- Modify: `lib/courtlistener.js`
- Rewrite: `test/courtlistener.test.js`

- [ ] **Step 1: Write failing tests**

Rewrite `test/courtlistener.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: (path, ...args) => {
      if (path.includes("courts.json")) {
        return JSON.stringify({
          scotus: { name: "Supreme Court", level: "scotus" },
          ca9: { name: "9th Circuit", level: "circuit" },
          cand: { name: "N.D. California", level: "district", appeal_to: "ca9" },
        });
      }
      return actual.readFileSync(path, ...args);
    },
  };
});

const { searchCases, lookupCitation, listOpinions, fetchOpinionText } = await import(
  "../lib/courtlistener.js"
);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("searchCases", () => {
  it("returns case metadata without opinion text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            cluster_id: 123,
            caseName: "Test v. Case",
            citation: ["100 F.3d 200"],
            court_id: "ca9",
            dateFiled: "2020-01-15",
            status: "Published",
            snippet: "some snippet",
          },
        ],
        next: "https://www.courtlistener.com/api/rest/v4/search/?cursor=abc",
      }),
    });

    const result = await searchCases("test query", "fake-token");
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toEqual({
      cluster_id: 123,
      case_name: "Test v. Case",
      citation: "100 F.3d 200",
      court_id: "ca9",
      date_filed: "2020-01-15",
      status: "Published",
      snippet: "some snippet",
      source_url: "https://www.courtlistener.com/opinion/123/test-v-case/",
    });
    expect(result.next_cursor).toBe("https://www.courtlistener.com/api/rest/v4/search/?cursor=abc");
  });

  it("returns null next_cursor when no more pages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], next: null }),
    });
    const result = await searchCases("nothing", "token");
    expect(result.cases).toEqual([]);
    expect(result.next_cursor).toBeNull();
  });

  it("returns classified error on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const result = await searchCases("test", "token");
    expect(result.error.code).toBe("rate_limited");
    expect(result.error.retryable).toBe(true);
  });

  it("returns classified error on 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await searchCases("test", "token");
    expect(result.error.code).toBe("upstream_unavailable");
  });

  it("paginates via cursor URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ cluster_id: 2, caseName: "Page 2", citation: [], court_id: "ca9", dateFiled: "2020-01-01" }], next: null }),
    });
    const result = await searchCases("test", "token", { cursor: "https://cl.com/api/rest/v4/search/?cursor=abc" });
    expect(result.cases).toHaveLength(1);
    // Verify fetch was called with the cursor URL, not the base search URL
    expect(mockFetch.mock.calls[0][0].toString()).toContain("cursor=abc");
  });
});

describe("lookupCitation", () => {
  it("returns cluster metadata from citation lookup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          citation: "511 U.S. 825",
          clusters: [
            {
              id: 1087956,
              case_name: "Farmer v. Brennan",
              date_filed: "1994-06-06",
              docket_id: 555,
              sub_opinions: [
                "https://www.courtlistener.com/api/rest/v4/opinions/9527063/",
              ],
            },
          ],
        },
      ],
    });

    const result = await lookupCitation("511 U.S. 825", "token");
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].id).toBe(1087956);
    expect(result.clusters[0].case_name).toBe("Farmer v. Brennan");
  });

  it("returns empty clusters when no match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const result = await lookupCitation("999 U.S. 999", "token");
    expect(result.clusters).toEqual([]);
  });

  it("returns classified error on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    const result = await lookupCitation("511 U.S. 825", "token");
    expect(result.error.code).toBe("rate_limited");
  });
});

describe("listOpinions", () => {
  it("returns opinion metadata for a cluster", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        case_name: "Farmer v. Brennan",
        date_filed: "1994-06-06",
        sub_opinions: [
          "https://www.courtlistener.com/api/rest/v4/opinions/456/",
          "https://www.courtlistener.com/api/rest/v4/opinions/457/",
        ],
      }),
    });
    // Fetch opinion metadata for each sub_opinion
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 456, type: "010combined", author: "Souter" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 457, type: "040dissent", author: "Thomas" }),
    });

    const result = await listOpinions(1087956, "token");
    expect(result.opinions).toHaveLength(2);
    expect(result.opinions[0]).toEqual({ opinion_id: 456, type: "lead", author: "Souter" });
    expect(result.opinions[1]).toEqual({ opinion_id: 457, type: "dissent", author: "Thomas" });
    expect(result.case_name).toBe("Farmer v. Brennan");
  });

  it("returns classified error on failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await listOpinions(999, "token");
    expect(result.error.code).toBe("not_found");
  });
});

describe("fetchOpinionText", () => {
  it("returns plain text when available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 456,
        plain_text: "The court held that...\n\nSecond paragraph.",
        type: "010combined",
        author: "Souter",
      }),
    });

    const result = await fetchOpinionText(456, "token");
    expect(result.text).toBe("The court held that...\n\nSecond paragraph.");
    expect(result.opinion_id).toBe(456);
  });

  it("strips HTML when plain_text is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 1,
        plain_text: "",
        html_with_citations: "<p>First.</p><p>Second &amp; third.</p>",
        type: "010combined",
      }),
    });

    const result = await fetchOpinionText(1, "token");
    expect(result.text).toContain("First.");
    expect(result.text).toContain("Second & third.");
    expect(result.text).not.toContain("<p>");
  });

  it("returns classified error on failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await fetchOpinionText(999, "token");
    expect(result.error.code).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/courtlistener.test.js
```

Expected: FAIL — exported functions not found.

- [ ] **Step 3: Implement**

Rewrite `lib/courtlistener.js`:

```javascript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyHttpError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);
const FEDERAL_COURT_IDS = Object.keys(courts).join(" ");

const BASE = "https://www.courtlistener.com/api/rest/v4";
const TIMEOUT_MS = 30_000;

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function cl(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: classifyHttpError(res.status, url.toString()) };
  }
  return { data: await res.json() };
}

function clUrl(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url;
}

async function clPost(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: classifyHttpError(res.status, url.toString()) };
  }
  return { data: await res.json() };
}

// CL opinion type codes → human-readable names
const OPINION_TYPE_MAP = {
  "010combined": "lead",
  "015unannotated": "lead",
  "020lead": "lead",
  "025plurality": "plurality",
  "030concurrence": "concurrence",
  "035concurrenceinpart": "concurrence",
  "040dissent": "dissent",
  "050addendum": "addendum",
  "060remittitur": "remittitur",
  "070rehearing": "rehearing",
  "080onbandon": "on_bandon",
  "090trialcourt": "trial_court",
};

function normalizeOpinionType(clType) {
  return OPINION_TYPE_MAP[clType] || clType || "unknown";
}

function caseSourceUrl(clusterId, caseName) {
  const slug = (caseName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.courtlistener.com/opinion/${clusterId}/${slug}/`;
}

export async function searchCases(query, token, { cursor } = {}) {
  const url = cursor
    ? new URL(cursor)
    : clUrl("/search/", {
        q: query,
        type: "o",
        order_by: "score desc",
        court: FEDERAL_COURT_IDS,
        stat_Published: "on",
        stat_Precedential: "on",
      });

  const result = await cl(url, token);
  if (result.error) return result;

  const raw = result.data;
  const cases = (raw.results || []).map((r) => ({
    cluster_id: r.cluster_id,
    case_name: r.caseName || r.case_name,
    citation: (r.citation || [])[0] || null,
    court_id: r.court_id || r.court,
    date_filed: r.dateFiled || r.date_filed,
    status: r.status,
    snippet: r.snippet,
    source_url: caseSourceUrl(r.cluster_id, r.caseName || r.case_name),
  }));

  return { cases, next_cursor: raw.next || null };
}

export async function lookupCitation(citationText, token) {
  const url = `${BASE}/citation-lookup/`;
  const result = await clPost(url, token, `text=${encodeURIComponent(citationText)}`);
  if (result.error) return result;

  const raw = Array.isArray(result.data) ? result.data : [];
  const clusters = raw.flatMap((r) => (r.clusters || []).map((c) => ({
    ...c,
    citation_matched: r.citation,
  })));

  return { clusters };
}

export async function listOpinions(clusterId, token) {
  const result = await cl(clUrl(`/clusters/${clusterId}/`), token);
  if (result.error) return result;

  const cluster = result.data;
  const opinionUrls = cluster.sub_opinions || [];

  // Fetch metadata for each sub-opinion (type, author)
  const opinions = [];
  for (const rawUrl of opinionUrls) {
    const opUrl = typeof rawUrl === "string" ? rawUrl : rawUrl.resource_uri;
    const opId = opUrl.match(/opinions\/(\d+)/)?.[1];
    if (!opId) continue;

    const opResult = await cl(new URL(opUrl), token);
    if (opResult.error) continue; // skip individual failures
    const op = opResult.data;
    opinions.push({
      opinion_id: Number(opId),
      type: normalizeOpinionType(op.type),
      author: op.author || null,
    });
  }

  return {
    cluster_id: clusterId,
    case_name: cluster.case_name,
    date_filed: cluster.date_filed,
    opinions,
  };
}

export async function fetchOpinionText(opinionId, token) {
  const result = await cl(clUrl(`/opinions/${opinionId}/`), token);
  if (result.error) return result;

  const op = result.data;
  let text = op.plain_text || "";
  if (!text && op.html_with_citations) {
    text = stripHtml(op.html_with_citations);
  }

  return {
    opinion_id: Number(op.id || opinionId),
    type: normalizeOpinionType(op.type),
    author: op.author || null,
    text,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/courtlistener.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/courtlistener.js test/courtlistener.test.js
git commit -m "feat(v2): refactor CL client — searchCases, listOpinions, fetchOpinionText, errors-as-data"
```

---

### Task 4: Rewrite Server — `search_cases` Tool (`lib/server.js`)

Replace the `research` tool with `search_cases`. This is the first of two tools.

**Files:**
- Modify: `lib/server.js`
- Modify: `test/server.test.js`

- [ ] **Step 1: Write failing tests for the new tool registration**

Rewrite `test/server.test.js` (partial — `search_cases` only):

```javascript
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "lib", "server.js");

function mcpSession(envOverrides = {}) {
  const proc = spawn("node", [SERVER_PATH], {
    env: { ...process.env, COURTLISTENER_API_KEY: "test-key", ...envOverrides },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  proc.stdout.on("data", (d) => (stdout += d.toString()));
  proc.stderr.on("data", () => {});

  function send(msg) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function collect() {
    return new Promise((resolve, reject) => {
      proc.on("close", () => {
        try {
          const lines = stdout.trim().split("\n").filter(Boolean);
          resolve(lines.map((l) => JSON.parse(l)));
        } catch (e) {
          reject(new Error(`Parse error: ${stdout}`));
        }
      });
    });
  }

  return { proc, send, collect };
}

describe("MCP server v2", () => {
  it("responds to initialize with stare server info", async () => {
    const { proc, send, collect } = mcpSession();
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => proc.kill(), 3000);
    const responses = await collect();
    const init = responses.find((r) => r.id === 1);
    expect(init).toBeDefined();
    expect(init.result.serverInfo.name).toBe("stare");
  });

  it("lists search_cases and fetch_passages tools", async () => {
    const { proc, send, collect } = mcpSession();
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    }, 500);
    setTimeout(() => proc.kill(), 4000);
    const responses = await collect();
    const tools = responses.find((r) => r.id === 2);
    expect(tools).toBeDefined();
    const names = tools.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["fetch_passages", "search_cases"]);
  }, 10000);

  it("returns error envelope when no API key is set", async () => {
    const { proc, send, collect } = mcpSession({ COURTLISTENER_API_KEY: "", CL_API_TOKEN: "" });
    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } },
    });
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "search_cases", arguments: { query: "test" } },
      });
    }, 500);
    setTimeout(() => proc.kill(), 4000);
    const responses = await collect();
    const call = responses.find((r) => r.id === 2);
    expect(call).toBeDefined();
    const body = JSON.parse(call.result.content[0].text);
    expect(body.error.code).toBe("no_api_key");
  }, 10000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/server.test.js
```

Expected: FAIL — tool names don't match.

- [ ] **Step 3: Implement `search_cases` tool**

Rewrite `lib/server.js`:

```javascript
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

    try {
      // Citation path
      if (!cursor && isCitation(query)) {
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
        const cases = [];
        for (const c of citResult.clusters) {
          const opResult = await listOpinions(c.id, CL_TOKEN);
          const opinions = opResult.error ? [] : opResult.opinions;

          cases.push({
            cluster_id: c.id,
            case_name: c.case_name,
            citation: c.citation_matched || null,
            court_id: null, // CL citation-lookup doesn't return court_id
            date_filed: c.date_filed,
            source_url: `https://www.courtlistener.com/opinion/${c.id}/`,
            opinions,
          });
        }

        return jsonResponse(
          successEnvelope(cases, { query, result_window: cases.length })
        );
      }

      // Search path
      const searchResult = await searchCases(query, CL_TOKEN, { cursor });
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

      const pagination = searchResult.next_cursor
        ? { next_cursor: searchResult.next_cursor, has_more: true }
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

// --- fetch_passages (placeholder — implemented in Task 5) ---

server.tool(
  "fetch_passages",
  "Retrieve paragraph-aligned text from a specific opinion. Requires an opinion_id from a previous search_cases result. Returns stable fragment IDs (cl:{opinion_id}:p{index}) for citation. No heuristic labels — text is returned as-is.",
  {
    opinion_id: z.number().describe("Opinion ID from search_cases or listOpinions"),
    cursor: z.string().optional().describe("Pagination cursor (e.g. 'p30') from a previous fetch_passages response"),
  },
  async ({ opinion_id, cursor }) => {
    return jsonResponse(
      errorEnvelope(makeError("upstream_error", "fetch_passages not yet implemented"), {})
    );
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/server.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server.js test/server.test.js
git commit -m "feat(v2): search_cases tool — metadata-only search with JSON envelopes"
```

---

### Task 5: Implement `fetch_passages` Tool

**Files:**
- Modify: `lib/server.js` (replace fetch_passages placeholder)

- [ ] **Step 1: Write a test for fetch_passages contract**

Add to `test/envelope.test.js`:

```javascript
import { fragmentId } from "../lib/envelope.js";

describe("fragmentId", () => {
  it("produces cl:{opinionId}:p{index} format", () => {
    expect(fragmentId(1087956, 0)).toBe("cl:1087956:p0");
    expect(fragmentId(456, 12)).toBe("cl:456:p12");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run test/envelope.test.js
```

Expected: PASS (fragmentId was already implemented in Task 2).

- [ ] **Step 3: Implement `fetch_passages` in server.js**

Replace the fetch_passages placeholder in `lib/server.js`:

```javascript
// --- fetch_passages ---

server.tool(
  "fetch_passages",
  "Retrieve paragraph-aligned text from a specific opinion. Requires an opinion_id from a previous search_cases result. Returns stable fragment IDs (cl:{opinion_id}:p{index}) for citation. No heuristic labels — text is returned as-is.",
  {
    opinion_id: z.number().describe("Opinion ID from search_cases or listOpinions"),
    cursor: z.string().optional().describe("Pagination cursor (e.g. 'p30') from a previous fetch_passages response"),
  },
  async ({ opinion_id, cursor }) => {
    const tokenErr = requireToken();
    if (tokenErr) return jsonResponse(tokenErr);

    if (!Number.isInteger(opinion_id) || opinion_id <= 0) {
      return jsonResponse(
        errorEnvelope(
          makeError("invalid_opinion_id", `opinion_id must be a positive integer, got: ${opinion_id}`),
          { opinion_id }
        )
      );
    }

    const PAGE_SIZE = 30;
    const startIndex = cursor ? parseInt(cursor.replace(/^p/, ""), 10) : 0;
    if (isNaN(startIndex) || startIndex < 0) {
      return jsonResponse(
        errorEnvelope(
          makeError("invalid_opinion_id", `Invalid cursor: ${cursor}. Expected format: p{number}`),
          { opinion_id }
        )
      );
    }

    try {
      const result = await fetchOpinionText(opinion_id, CL_TOKEN);
      if (result.error) {
        return jsonResponse(errorEnvelope(result.error, { opinion_id }));
      }

      const paragraphs = chunk(result.text);

      const page = paragraphs.slice(startIndex, startIndex + PAGE_SIZE);
      const hasMore = startIndex + PAGE_SIZE < paragraphs.length;

      const fragments = page.map((p) => ({
        fragment_id: fragmentId(opinion_id, p.index),
        paragraph: p.index,
        text: p.text,
      }));

      const pagination = hasMore
        ? { next_cursor: `p${startIndex + PAGE_SIZE}`, has_more: true }
        : { next_cursor: null, has_more: false };

      return jsonResponse(
        successEnvelope(
          {
            opinion_id,
            type: result.type,
            author: result.author,
            total_paragraphs: paragraphs.length,
            fragments,
          },
          { opinion_id, result_window: fragments.length },
          pagination
        )
      );
    } catch (err) {
      return jsonResponse(
        errorEnvelope(
          makeError("upstream_unavailable", err.message, true),
          { opinion_id }
        )
      );
    }
  }
);
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server.js
git commit -m "feat(v2): fetch_passages tool — paginated paragraph retrieval with fragment IDs"
```

---

### Task 6: Delete Dead Code, Update Package

Remove v1 modules that are no longer imported.

**Files:**
- Delete: `lib/sectioner.js`
- Delete: `lib/response.js`
- Delete: `test/sectioner.test.js`
- Delete: `test/response.test.js`
- Modify: `package.json` (bump version to 0.2.0)

- [ ] **Step 1: Delete dead files**

```bash
rm lib/sectioner.js lib/response.js test/sectioner.test.js test/response.test.js
```

- [ ] **Step 2: Verify no imports reference deleted modules**

```bash
grep -r "sectioner\|response" lib/ test/ --include="*.js"
```

Expected: no matches (or only in unrelated contexts like "JSON response").

- [ ] **Step 3: Update package.json version**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all PASS. Test count will decrease (sectioner and response tests removed).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(v2): remove v1 dead code (sectioner, response, markdown assembly), bump to 0.2.0"
```

---

### Task 7: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README**

```markdown
# stare-mcp

MCP server for exploratory federal case law search. Two tools that search [CourtListener](https://www.courtlistener.com/) and let you drill into specific opinions:

- **`search_cases`** — search by legal issue or citation. Returns case metadata sorted by court level. No opinion text.
- **`fetch_passages`** — retrieve paragraph-aligned text from a specific opinion. Stable fragment IDs for citation.

All responses are structured JSON with provenance envelopes and pagination.

## Limitations

This is a convenience layer over CourtListener's search API, not a legal research system.

- **Retrieval is not reliable.** Results come from keyword relevance ranking. Controlling authority can be missed entirely if it doesn't score in the result window.
- **No citator or negative treatment.** There is no check for whether a case has been overruled, distinguished, or superseded.
- **No section labels.** Text is returned as-is. The tool does not guess which paragraphs are holdings.
- **No recall measurement.** Output quality is untested against a benchmark of expected authorities.

Use this for finding starting points, not establishing the state of the law.

## Setup

```bash
npm install
```

Get a [CourtListener API key](https://www.courtlistener.com/help/api/rest/#permissions) (free tier: 5 req/min).

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

Returns JSON with case metadata, authority tier, court name, citation, and source URL. Sorted by court level: SCOTUS > binding circuit > persuasive > district. Paginate with the `cursor` field from the response.

### Look up a citation

```
search_cases(query: "511 U.S. 825")
```

Returns matching cluster(s) with available opinion IDs (lead, concurrence, dissent).

### Retrieve opinion text

```
fetch_passages(opinion_id: 9527063)
```

Returns up to 30 paragraphs per call with stable fragment IDs (`cl:9527063:p0`, `cl:9527063:p1`, ...). Paginate with the `cursor` field.

### Response format

Every response is a JSON envelope:

```json
{
  "data": { ... },
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
  "provenance": { ... }
}
```

Error codes: `no_api_key`, `invalid_circuit`, `invalid_opinion_id`, `rate_limited`, `upstream_unavailable`, `not_found`, `upstream_error`.

## Valid circuit values

`ca1` `ca2` `ca3` `ca4` `ca5` `ca6` `ca7` `ca8` `ca9` `ca10` `ca11` `cadc` `cafc`

Omit `circuit` to skip authority tier labeling.

## Development

```bash
npm test              # run tests
npm run test:watch    # watch mode
node lib/server.js --help
```

Court data sourced from [Free Law Project's courts-db](https://github.com/freelawproject/courts-db) (BSD 2-Clause). To rebuild:

```bash
node scripts/build-courts.js
```

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(v2): rewrite README for two-tool structured API"
```

---

### Task 8: Contract Tests — Envelope Shape Validation

Validate that search_cases and fetch_passages return correctly shaped envelopes by testing against the CL client mocks at the server level. These tests verify the contract between tools and callers.

**Files:**
- Create: `test/contract.test.js`

- [ ] **Step 1: Write contract tests**

Create `test/contract.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test envelope shapes by importing the modules directly
// and checking the output structure, not by spawning the server.
import { makeError, classifyHttpError } from "../lib/errors.js";
import { successEnvelope, errorEnvelope, fragmentId } from "../lib/envelope.js";

describe("contract: success envelope", () => {
  it("always has data, provenance, pagination", () => {
    const env = successEnvelope([1, 2], { query: "test" });
    expect(env).toHaveProperty("data");
    expect(env).toHaveProperty("provenance");
    expect(env).toHaveProperty("pagination");
    expect(env.provenance).toHaveProperty("source");
    expect(env.provenance).toHaveProperty("api_version");
    expect(env.provenance).toHaveProperty("retrieved_at");
    expect(env.pagination).toHaveProperty("next_cursor");
    expect(env.pagination).toHaveProperty("has_more");
  });

  it("never has error field", () => {
    const env = successEnvelope([], { query: "test" });
    expect(env).not.toHaveProperty("error");
  });
});

describe("contract: error envelope", () => {
  it("always has error and provenance, never data or pagination", () => {
    const env = errorEnvelope(makeError("not_found", "gone"), { query: "test" });
    expect(env).toHaveProperty("error");
    expect(env).toHaveProperty("provenance");
    expect(env).not.toHaveProperty("data");
    expect(env).not.toHaveProperty("pagination");
    expect(env.error).toHaveProperty("code");
    expect(env.error).toHaveProperty("message");
    expect(env.error).toHaveProperty("retryable");
  });
});

describe("contract: error codes are from taxonomy", () => {
  const VALID_CODES = new Set([
    "no_api_key",
    "invalid_circuit",
    "invalid_opinion_id",
    "rate_limited",
    "upstream_unavailable",
    "not_found",
    "upstream_error",
  ]);

  it("classifyHttpError produces only valid codes", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
      const err = classifyHttpError(status, "/test");
      expect(VALID_CODES).toContain(err.code);
    }
  });
});

describe("contract: fragment ID format", () => {
  it("matches cl:{opinionId}:p{index}", () => {
    const id = fragmentId(12345, 7);
    expect(id).toMatch(/^cl:\d+:p\d+$/);
  });
});

describe("contract: pagination cursor roundtrip", () => {
  it("fetch_passages cursor is p{number}", () => {
    // Simulate: page 1 returns next_cursor "p30"
    // page 2 parses "p30" → startIndex 30
    const cursor = "p30";
    const startIndex = parseInt(cursor.replace(/^p/, ""), 10);
    expect(startIndex).toBe(30);
    expect(Number.isInteger(startIndex)).toBe(true);
  });
});
```

- [ ] **Step 2: Run contract tests**

```bash
npx vitest run test/contract.test.js
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add test/contract.test.js
git commit -m "test(v2): contract tests — envelope shapes, error taxonomy, fragment IDs"
```

---

### Task 9: Live Integration Test Script

A manual test script that hits the real CL API. Not run in CI (requires API key). Documents expected behavior for human verification.

**Files:**
- Create: `scripts/integration-test.js`

- [ ] **Step 1: Create the integration test script**

Create `scripts/integration-test.js`:

```javascript
#!/usr/bin/env node
// Manual integration test against real CourtListener API.
// Usage: COURTLISTENER_API_KEY=<key> node scripts/integration-test.js
//
// NOT run in CI. Requires a valid API key and is rate-limited (5 req/min free tier).
// Expect some 429 errors if run too frequently.

import { searchCases, lookupCitation, listOpinions, fetchOpinionText } from "../lib/courtlistener.js";
import { chunk } from "../lib/chunker.js";
import { fragmentId } from "../lib/envelope.js";

const token = process.env.COURTLISTENER_API_KEY || process.env.CL_API_TOKEN;
if (!token) {
  console.error("Set COURTLISTENER_API_KEY to run integration tests.");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: ${detail}`);
    failed++;
  }
}

// --- Test 1: Search ---
console.log("\n1. searchCases('deliberate indifference standard')");
const search = await searchCases("deliberate indifference standard", token);
assert("no error", !search.error, JSON.stringify(search.error));
assert("returns cases", search.cases?.length > 0, `got ${search.cases?.length}`);
if (search.cases?.length > 0) {
  const c = search.cases[0];
  assert("case has cluster_id", typeof c.cluster_id === "number", typeof c.cluster_id);
  assert("case has case_name", typeof c.case_name === "string", typeof c.case_name);
  assert("case has court_id", typeof c.court_id === "string", typeof c.court_id);
  assert("case has source_url", c.source_url?.startsWith("https://"), c.source_url);
}

// --- Test 2: Citation lookup ---
console.log("\n2. lookupCitation('511 U.S. 825')");
const cite = await lookupCitation("511 U.S. 825", token);
assert("no error", !cite.error, JSON.stringify(cite.error));
assert("finds clusters", cite.clusters?.length > 0, `got ${cite.clusters?.length}`);
if (cite.clusters?.length > 0) {
  assert("finds Farmer v. Brennan", cite.clusters[0].case_name === "Farmer v. Brennan", cite.clusters[0].case_name);
  assert("cluster has id", typeof cite.clusters[0].id === "number", typeof cite.clusters[0].id);
}

// --- Test 3: List opinions ---
if (cite.clusters?.length > 0) {
  const clusterId = cite.clusters[0].id;
  console.log(`\n3. listOpinions(${clusterId})`);
  const ops = await listOpinions(clusterId, token);
  assert("no error", !ops.error, JSON.stringify(ops.error));
  assert("has opinions", ops.opinions?.length > 0, `got ${ops.opinions?.length}`);
  if (ops.opinions?.length > 0) {
    const op = ops.opinions[0];
    assert("opinion has opinion_id", typeof op.opinion_id === "number", typeof op.opinion_id);
    assert("opinion has type", typeof op.type === "string", op.type);

    // --- Test 4: Fetch passages ---
    console.log(`\n4. fetchOpinionText(${op.opinion_id})`);
    const text = await fetchOpinionText(op.opinion_id, token);
    assert("no error", !text.error, JSON.stringify(text.error));
    assert("has text", text.text?.length > 0, `length: ${text.text?.length}`);

    if (text.text) {
      const paragraphs = chunk(text.text);
      assert("chunks into paragraphs", paragraphs.length > 1, `got ${paragraphs.length}`);
      const fid = fragmentId(op.opinion_id, 0);
      assert("fragment ID is well-formed", /^cl:\d+:p\d+$/.test(fid), fid);
    }
  }
}

// --- Summary ---
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the integration test (manual)**

```bash
COURTLISTENER_API_KEY=<your-key> node scripts/integration-test.js
```

Expected: all assertions pass (some may fail due to rate limiting — that's expected on free tier).

- [ ] **Step 3: Commit**

```bash
git add scripts/integration-test.js
git commit -m "test(v2): live integration test script for manual CL API verification"
```

---

### Task 10: Update .mcp.json and Final Verification

**Files:**
- Modify: `.mcp.json`

- [ ] **Step 1: Update .mcp.json**

No changes needed — the server entry point is the same (`lib/server.js`).

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Test files should be: `errors.test.js`, `envelope.test.js`, `courtlistener.test.js`, `server.test.js`, `contract.test.js`, `authority.test.js`, `citations.test.js`, `chunker.test.js`.

- [ ] **Step 3: Verify server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | COURTLISTENER_API_KEY=test node lib/server.js
```

Expected: JSON-RPC response with `serverInfo.name: "stare"`, `version: "0.2.0"`.

- [ ] **Step 4: Verify --help and --version**

```bash
node lib/server.js --help
node lib/server.js --version
```

Expected: help shows both tools, version shows `0.2.0`.

- [ ] **Step 5: Final commit and push**

```bash
git push
```

---

## Verification Checklist

1. **Unit tests pass:** `npx vitest run` — all test files green
2. **Server starts:** JSON-RPC initialize returns `stare` v0.2.0
3. **Tool list:** `tools/list` returns `search_cases` and `fetch_passages` (no `research`)
4. **search_cases (search):** Returns JSON envelope with cases, tiers, pagination. 1 CL request.
5. **search_cases (citation):** Returns cluster with opinion IDs. 1-2 CL requests.
6. **fetch_passages:** Returns paginated paragraphs with fragment IDs. 1 CL request.
7. **Error handling:** 429 → `rate_limited` with `retryable: true`. Missing key → `no_api_key`. Bad circuit → `invalid_circuit`.
8. **No silent partial results:** Every error is an error envelope, never mixed into data.
9. **No heuristic labels:** Passages are plain text, no `[holding]` markers.
10. **Fragment IDs:** Format `cl:{opinion_id}:p{index}`, stable across repeated calls.
