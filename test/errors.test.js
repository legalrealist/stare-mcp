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
