import { describe, it, expect } from "vitest";
import { queryHash, wrapCursor, unwrapCursor } from "../lib/cursor.js";

describe("queryHash", () => {
  it("produces a stable 8-char hex hash", () => {
    const h = queryHash("deliberate indifference", "ca9");
    expect(h).toMatch(/^[a-f0-9]{8}$/);
    // Same inputs → same hash
    expect(queryHash("deliberate indifference", "ca9")).toBe(h);
  });

  it("different queries produce different hashes", () => {
    expect(queryHash("query A", "ca9")).not.toBe(queryHash("query B", "ca9"));
  });

  it("different circuits produce different hashes", () => {
    expect(queryHash("same query", "ca9")).not.toBe(queryHash("same query", "ca2"));
  });

  it("handles undefined circuit", () => {
    const h = queryHash("test", undefined);
    expect(h).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("wrapCursor", () => {
  it("wraps CL cursor with query hash prefix", () => {
    const wrapped = wrapCursor("cj0xJnA9MjAyMQ", "test query", "ca9");
    expect(wrapped).toMatch(/^qh:[a-f0-9]{8}:cj0xJnA9MjAyMQ$/);
  });

  it("returns null for null cursor", () => {
    expect(wrapCursor(null, "test", "ca9")).toBeNull();
  });
});

describe("unwrapCursor", () => {
  it("roundtrips with wrapCursor for same query", () => {
    const wrapped = wrapCursor("abc123", "my query", "ca9");
    const result = unwrapCursor(wrapped, "my query", "ca9");
    expect(result.clCursor).toBe("abc123");
    expect(result.error).toBeUndefined();
  });

  it("rejects cursor from different query", () => {
    const wrapped = wrapCursor("abc123", "query A", "ca9");
    const result = unwrapCursor(wrapped, "query B", "ca9");
    expect(result.error).toBe("invalid_cursor");
    expect(result.message).toContain("different query");
  });

  it("rejects cursor from different circuit", () => {
    const wrapped = wrapCursor("abc123", "same query", "ca9");
    const result = unwrapCursor(wrapped, "same query", "ca2");
    expect(result.error).toBe("invalid_cursor");
    expect(result.message).toContain("different query");
  });

  it("rejects malformed cursor format", () => {
    const result = unwrapCursor("not-a-valid-cursor", "query", "ca9");
    expect(result.error).toBe("invalid_cursor");
    expect(result.message).toContain("Invalid cursor format");
  });

  it("rejects raw CL cursor (not wrapped)", () => {
    const result = unwrapCursor("cj0xJnA9MjAyMQ", "query", "ca9");
    expect(result.error).toBe("invalid_cursor");
  });

  it("returns null clCursor for null input", () => {
    const result = unwrapCursor(null, "query", "ca9");
    expect(result.clCursor).toBeNull();
    expect(result.error).toBeUndefined();
  });
});
