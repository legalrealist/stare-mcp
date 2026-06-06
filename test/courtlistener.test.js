import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch before importing the module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Must dynamically import after stubbing fetch, and also need to mock
// the courts.json read that happens at module load
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

const { searchOpinions, fetchOpinion, lookupCitation } = await import(
  "../lib/courtlistener.js"
);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("searchOpinions", () => {
  it("maps CL search results to normalized shape", async () => {
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
      }),
    });

    const results = await searchOpinions("test query", "fake-token");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      cluster_id: 123,
      case_name: "Test v. Case",
      citation: "100 F.3d 200",
      court_id: "ca9",
      date_filed: "2020-01-15",
      status: "Published",
      snippet: "some snippet",
    });
  });

  it("returns empty array when no results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    const results = await searchOpinions("nothing", "token");
    expect(results).toEqual([]);
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(searchOpinions("test", "token")).rejects.toThrow("CL API 429");
  });

  it("respects count parameter", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      cluster_id: i,
      caseName: `Case ${i}`,
      citation: [],
      court_id: "ca9",
      dateFiled: "2020-01-01",
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: many }),
    });
    const results = await searchOpinions("test", "token", { count: 5 });
    expect(results).toHaveLength(5);
  });
});

describe("fetchOpinion", () => {
  it("fetches cluster then lead opinion text", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub_opinions: ["https://www.courtlistener.com/api/rest/v4/opinions/456/"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          plain_text: "The court held that...",
          type: "lead",
        }),
      });

    const result = await fetchOpinion(123, "token");
    expect(result.text).toBe("The court held that...");
    expect(result.type).toBe("lead");
  });

  it("strips HTML when plain_text is empty", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub_opinions: ["https://cl.com/api/rest/v4/opinions/1/"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          plain_text: "",
          html_with_citations: "<p>First paragraph.</p><p>Second &amp; third.</p>",
          type: "lead",
        }),
      });

    const result = await fetchOpinion(1, "token");
    expect(result.text).toContain("First paragraph.");
    expect(result.text).toContain("Second & third.");
    expect(result.text).not.toContain("<p>");
  });

  it("returns null when cluster has no sub_opinions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sub_opinions: [] }),
    });
    const result = await fetchOpinion(999, "token");
    expect(result).toBeNull();
  });
});

describe("lookupCitation", () => {
  it("flattens clusters from CL response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          citation: "511 U.S. 825",
          clusters: [
            { id: 1087956, case_name: "Farmer v. Brennan", date_filed: "1994-06-06" },
          ],
        },
      ],
    });

    const results = await lookupCitation("511 U.S. 825", "token");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1087956);
    expect(results[0].case_name).toBe("Farmer v. Brennan");
  });

  it("returns empty array when no clusters match", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const results = await lookupCitation("999 U.S. 999", "token");
    expect(results).toEqual([]);
  });

  it("throws on non-2xx instead of returning empty", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(lookupCitation("511 U.S. 825", "token")).rejects.toThrow(
      "CL API 429"
    );
  });
});
