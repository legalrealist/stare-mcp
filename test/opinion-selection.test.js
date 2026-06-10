import { describe, expect, it } from "vitest";
import { resolveOpinionSelection } from "../lib/opinion-selection.js";

describe("resolveOpinionSelection", () => {
  it("returns not_found for an empty opinion list", () => {
    const result = resolveOpinionSelection({ opinions: [] }, 42);

    expect(result.error.code).toBe("not_found");
  });

  it("selects the sole lead opinion", () => {
    const result = resolveOpinionSelection(
      {
        opinions: [
          { opinion_id: 123, type: "lead" },
          { opinion_id: 124, type: "dissent" },
        ],
      },
      42,
    );

    expect(result).toEqual({ opinionId: 123 });
  });

  it("selects the only opinion regardless of type", () => {
    const result = resolveOpinionSelection(
      { opinions: [{ opinion_id: 200, type: "dissent" }] },
      42,
    );

    expect(result).toEqual({ opinionId: 200 });
  });

  it("requires selection when multiple opinions have no unique lead", () => {
    const opinions = [
      { opinion_id: 123, type: "concurrence" },
      { opinion_id: 124, type: "dissent" },
    ];
    const result = resolveOpinionSelection({ opinions }, 42);

    expect(result.error.code).toBe("selection_required");
    expect(result.error.opinions).toEqual(opinions);
    expect(result.error.cluster_id).toBe(42);
  });

  it("requires selection when multiple lead opinions exist", () => {
    // Real case: SCOTUS clusters often carry both a 010combined and a
    // 020lead opinion, which both normalize to "lead"
    const opinions = [
      { opinion_id: 1, type: "lead" },
      { opinion_id: 2, type: "lead" },
      { opinion_id: 3, type: "dissent" },
    ];
    const result = resolveOpinionSelection({ opinions }, 42);

    expect(result.error.code).toBe("selection_required");
  });
});
