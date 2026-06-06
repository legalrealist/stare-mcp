import { describe, it, expect } from "vitest";
import { isCitation, parseCitation } from "../lib/citations.js";

describe("isCitation", () => {
  it("detects U.S. Reports citations", () => {
    expect(isCitation("511 U.S. 825")).toBe(true);
  });

  it("detects Federal Reporter citations", () => {
    expect(isCitation("391 F.3d 1051")).toBe(true);
    expect(isCitation("200 F.2d 100")).toBe(true);
  });

  it("detects Federal Supplement citations", () => {
    expect(isCitation("100 F. Supp. 2d 500")).toBe(true);
    expect(isCitation("250 F. Supp. 3d 100")).toBe(true);
  });

  it("rejects natural language queries", () => {
    expect(isCitation("deliberate indifference standard")).toBe(false);
    expect(isCitation("qualified immunity")).toBe(false);
    expect(isCitation("what is the test for summary judgment")).toBe(false);
  });

  it("rejects queries with citations embedded in prose", () => {
    expect(isCitation("see 511 U.S. 825 and also")).toBe(false);
  });
});

describe("parseCitation", () => {
  it("extracts volume, reporter, and page", () => {
    const parsed = parseCitation("511 U.S. 825");
    expect(parsed).not.toBeNull();
    expect(parsed.volume).toBe(511);
    expect(parsed.page).toBe(825);
  });

  it("returns null for non-citations", () => {
    expect(parseCitation("not a citation")).toBeNull();
  });
});
