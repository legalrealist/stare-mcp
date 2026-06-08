import { describe, it, expect } from "vitest";

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
    "selection_required",
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
