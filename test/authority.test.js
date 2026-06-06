import { describe, it, expect } from "vitest";
import { getTier, rankByAuthority, validateCircuit } from "../lib/authority.js";

describe("getTier", () => {
  it("SCOTUS is always tier 1", () => {
    expect(getTier("scotus", "ca9")).toBe(1);
    expect(getTier("scotus", null)).toBe(1);
  });

  it("matching circuit is tier 2 (binding)", () => {
    expect(getTier("ca9", "ca9")).toBe(2);
  });

  it("other circuit is tier 3 (persuasive)", () => {
    expect(getTier("ca2", "ca9")).toBe(3);
  });

  it("district in binding circuit is tier 4", () => {
    expect(getTier("cand", "ca9")).toBe(4);
  });

  it("district in other circuit is tier 4", () => {
    expect(getTier("nysd", "ca9")).toBe(4);
  });

  it("without circuit, circuits are tier 3 (persuasive) and districts are tier 4", () => {
    expect(getTier("ca9", null)).toBe(3);
    expect(getTier("cand", null)).toBe(4);
  });

  it("unknown court returns tier 5", () => {
    expect(getTier("unknown_court", "ca9")).toBe(5);
  });
});

describe("rankByAuthority", () => {
  it("sorts results by tier then by date descending", () => {
    const results = [
      { court_id: "ca2",    date_filed: "2020-01-01" },
      { court_id: "scotus", date_filed: "1994-06-06" },
      { court_id: "ca9",    date_filed: "2004-12-01" },
      { court_id: "cand",   date_filed: "2022-03-15" },
    ];
    const ranked = rankByAuthority(results, "ca9");
    expect(ranked.map((r) => r.court_id)).toEqual([
      "scotus", "ca9", "ca2", "cand",
    ]);
  });

  it("within same tier, newer cases come first", () => {
    const results = [
      { court_id: "ca2", date_filed: "2010-01-01" },
      { court_id: "ca5", date_filed: "2020-01-01" },
    ];
    const ranked = rankByAuthority(results, "ca9");
    expect(ranked[0].court_id).toBe("ca5");
  });

  it("attaches tier to each result", () => {
    const results = [{ court_id: "scotus", date_filed: "2000-01-01" }];
    const ranked = rankByAuthority(results, "ca9");
    expect(ranked[0].tier).toBe(1);
  });

  it("handles null date_filed without crashing", () => {
    const results = [
      { court_id: "ca9", date_filed: null },
      { court_id: "ca2", date_filed: "2020-01-01" },
    ];
    const ranked = rankByAuthority(results, "ca9");
    expect(ranked).toHaveLength(2);
    expect(ranked[0].court_id).toBe("ca9");
  });
});

describe("validateCircuit", () => {
  it("accepts valid circuit IDs", () => {
    expect(validateCircuit("ca9")).toBeNull();
    expect(validateCircuit("ca2")).toBeNull();
    expect(validateCircuit("cadc")).toBeNull();
    expect(validateCircuit("cafc")).toBeNull();
  });

  it("accepts null/undefined (no circuit)", () => {
    expect(validateCircuit(null)).toBeNull();
    expect(validateCircuit(undefined)).toBeNull();
  });

  it("rejects invalid circuit IDs with helpful message", () => {
    const err = validateCircuit("ca09");
    expect(err).toContain('Unknown circuit "ca09"');
    expect(err).toContain("ca9");
  });
});
