import { describe, it, expect } from "vitest";
import { chunk } from "../lib/chunker.js";

describe("chunk", () => {
  it("splits text into paragraphs on double newlines", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird.";
    const result = chunk(text);
    expect(result).toEqual([
      { index: 0, text: "First paragraph." },
      { index: 1, text: "Second paragraph." },
      { index: 2, text: "Third." },
    ]);
  });

  it("handles various whitespace between paragraphs", () => {
    const text = "One.\n\n\nTwo.\n \n \nThree.";
    expect(chunk(text)).toHaveLength(3);
  });

  it("trims whitespace from paragraphs", () => {
    const text = "  Hello.  \n\n  World.  ";
    const result = chunk(text);
    expect(result[0].text).toBe("Hello.");
    expect(result[1].text).toBe("World.");
  });

  it("drops empty paragraphs", () => {
    const text = "Real.\n\n\n\n\n\nAlso real.";
    expect(chunk(text)).toHaveLength(2);
  });

  it("returns empty array for empty/whitespace input", () => {
    expect(chunk("")).toEqual([]);
    expect(chunk("   ")).toEqual([]);
  });
});
