import { describe, expect, it } from "vitest";
import { resolveOpinionSelection } from "../lib/opinion-selection.js";

describe("resolveOpinionSelection", () => {
  it("rejects auto-selection when some opinion metadata is unavailable", () => {
    const result = resolveOpinionSelection(
      {
        case_name: "Test Case",
        opinions: [{ opinion_id: 123, type: "lead" }],
        skipped_opinions: 1,
      },
      42,
    );

    expect(result.error.code).toBe("selection_required");
    expect(result.error.partial).toBe(true);
    expect(result.error.opinions).toHaveLength(1);
  });

  it("reports partial data rather than not_found when every lookup failed", () => {
    const result = resolveOpinionSelection(
      { opinions: [], skipped_opinions: 2 },
      42,
    );

    expect(result.error.code).toBe("selection_required");
    expect(result.error.partial).toBe(true);
  });

  it("returns not_found only for a complete empty result", () => {
    const result = resolveOpinionSelection(
      { opinions: [], skipped_opinions: 0 },
      42,
    );

    expect(result.error.code).toBe("not_found");
  });

  it("selects the sole lead opinion", () => {
    const result = resolveOpinionSelection(
      {
        opinions: [
          { opinion_id: 123, type: "lead" },
          { opinion_id: 124, type: "dissent" },
        ],
        skipped_opinions: 0,
      },
      42,
    );

    expect(result).toEqual({ opinionId: 123 });
  });

  it("requires selection when multiple opinions have no unique lead", () => {
    const opinions = [
      { opinion_id: 123, type: "concurrence" },
      { opinion_id: 124, type: "dissent" },
    ];
    const result = resolveOpinionSelection(
      { opinions, skipped_opinions: 0 },
      42,
    );

    expect(result.error.code).toBe("selection_required");
    expect(result.error.opinions).toEqual(opinions);
  });
});
