import { describe, it, expect } from "vitest";
import { assembleResponse, filterFragments } from "../lib/response.js";

describe("filterFragments", () => {
  it("keeps holding and analysis by default", () => {
    const fragments = [
      { section: "holding", text: "We hold..." },
      { section: "analysis", text: "We consider..." },
      { section: "facts", text: "In 2019..." },
      { section: "unlabeled", text: "Some text." },
    ];
    const filtered = filterFragments(fragments);
    expect(filtered.kept).toHaveLength(2);
    expect(filtered.droppedCount).toBe(2);
  });

  it("keeps standard_of_review too", () => {
    const fragments = [
      { section: "standard_of_review", text: "We review de novo." },
    ];
    expect(filterFragments(fragments).kept).toHaveLength(1);
  });
});

describe("assembleResponse", () => {
  it("produces tiered markdown", () => {
    const opinions = [
      {
        tier: 1,
        tierLabel: "Controlling Authority",
        case_name: "Farmer v. Brennan",
        citation: "511 U.S. 825",
        court_name: "Supreme Court",
        date_filed: "1994-06-06",
        fragments: [{ section: "holding", text: "We hold that..." }],
      },
      {
        tier: 2,
        tierLabel: "Binding Circuit Authority (9th Cir.)",
        case_name: "Toguchi v. Chung",
        citation: "391 F.3d 1051",
        court_name: "9th Circuit",
        date_filed: "2004-12-01",
        fragments: [{ section: "analysis", text: "We apply..." }],
      },
    ];
    const md = assembleResponse(opinions, { query: "deliberate indifference", circuit: "ca9" });
    expect(md).toContain("## Tier 1");
    expect(md).toContain("Farmer v. Brennan");
    expect(md).toContain("## Tier 2");
    expect(md).toContain("Toguchi v. Chung");
    expect(md).toContain("[holding — heuristic]");
    expect(md).toContain("Section labels are heuristic");
  });

  it("includes footer with hints", () => {
    const opinions = [{
      tier: 1, tierLabel: "Controlling", case_name: "Test",
      citation: "1 U.S. 1", court_name: "SCOTUS", date_filed: "2000-01-01",
      fragments: [{ section: "holding", text: "Held." }],
    }];
    const md = assembleResponse(opinions, { query: "test query" });
    expect(md).toContain("research(");
  });

  it("reports fetch failures explicitly", () => {
    const opinions = [
      {
        tier: 1, tierLabel: "Controlling", case_name: "Good",
        citation: "1 U.S. 1", court_name: "SCOTUS", date_filed: "2000-01-01",
        fragments: [{ section: "holding", text: "Held." }],
        totalFragments: 5,
      },
      {
        tier: 3, tierLabel: "Persuasive", case_name: "Failed",
        citation: "2 F.3d 2", court_name: "2nd Circuit", date_filed: "2020-01-01",
        fragments: [{ section: "error", text: "(fetch failed: CL API 429)" }],
        totalFragments: 0,
      },
    ];
    const md = assembleResponse(opinions, { query: "test" });
    expect(md).toContain("Retrieved 1 of 2 opinions");
    expect(md).toContain("1 failed");
  });

  it("returns NO_AUTHORITY_FOUND for empty results", () => {
    const md = assembleResponse([], { query: "test" });
    expect(md).toContain("[NO_AUTHORITY_FOUND]");
  });
});
