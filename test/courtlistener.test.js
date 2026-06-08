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
    const result = await searchCases("test", "token", { cursor: "https://www.courtlistener.com/api/rest/v4/search/?cursor=abc" });
    expect(result.cases).toHaveLength(1);
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
