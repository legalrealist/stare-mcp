import { describe, it, expect } from "vitest";
import { successEnvelope, errorEnvelope, FRAGMENT_PREFIX, fragmentId, parseFragmentId } from "../lib/envelope.js";

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

describe("fragmentId", () => {
  it("produces cl:{opinionId}:p{index} format", () => {
    expect(fragmentId(1087956, 0)).toBe("cl:1087956:p0");
    expect(fragmentId(456, 12)).toBe("cl:456:p12");
  });
});

describe("parseFragmentId", () => {
  it("roundtrips with fragmentId", () => {
    expect(parseFragmentId(fragmentId(1087956, 12))).toEqual({
      opinion_id: 1087956,
      paragraph: 12,
    });
    expect(parseFragmentId("cl:456:p0")).toEqual({ opinion_id: 456, paragraph: 0 });
  });

  it("returns null for malformed IDs", () => {
    expect(parseFragmentId("cl:abc:p1")).toBeNull();
    expect(parseFragmentId("cl:123:p")).toBeNull();
    expect(parseFragmentId("cl:123")).toBeNull();
    expect(parseFragmentId("123:p4")).toBeNull();
    expect(parseFragmentId("cl:123:p4:extra")).toBeNull();
    expect(parseFragmentId("")).toBeNull();
    expect(parseFragmentId(null)).toBeNull();
    expect(parseFragmentId(undefined)).toBeNull();
  });
});
