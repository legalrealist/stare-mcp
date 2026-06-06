import { describe, it, expect } from "vitest";
import { labelSections } from "../lib/sectioner.js";

describe("labelSections", () => {
  it("labels paragraphs under structural headers", () => {
    const paragraphs = [
      { index: 0, text: "I. BACKGROUND" },
      { index: 1, text: "The plaintiff filed suit in 2019." },
      { index: 2, text: "II. DISCUSSION" },
      { index: 3, text: "We review de novo." },
      { index: 4, text: "III. CONCLUSION" },
      { index: 5, text: "For these reasons, we affirm." },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("background");
    expect(labeled[1].section).toBe("background");
    expect(labeled[2].section).toBe("analysis");
    expect(labeled[3].section).toBe("analysis");
    expect(labeled[4].section).toBe("conclusion");
    expect(labeled[5].section).toBe("conclusion");
  });

  it("detects holding via transition phrases", () => {
    const paragraphs = [
      { index: 0, text: "We hold that the district court erred in granting summary judgment." },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("holding");
  });

  it("detects standard of review", () => {
    const paragraphs = [
      { index: 0, text: "We review de novo the district court's grant of summary judgment." },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("standard_of_review");
  });

  it("detects facts section", () => {
    const paragraphs = [
      { index: 0, text: "The facts are as follows. In 2018 the defendant..." },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("facts");
  });

  it("detects dissent", () => {
    const paragraphs = [
      { index: 0, text: "JONES, Circuit Judge, dissenting:" },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("dissent");
  });

  it("falls back to unlabeled", () => {
    const paragraphs = [
      { index: 0, text: "The court heard oral arguments on March 5." },
    ];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].section).toBe("unlabeled");
  });

  it("preserves original paragraph data", () => {
    const paragraphs = [{ index: 3, text: "Some text." }];
    const labeled = labelSections(paragraphs);
    expect(labeled[0].index).toBe(3);
    expect(labeled[0].text).toBe("Some text.");
  });
});
