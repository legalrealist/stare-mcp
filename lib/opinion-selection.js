import { makeError } from "./errors.js";

const LEAD_TYPES = new Set(["lead", "plurality"]);

export function resolveOpinionSelection(opList, clusterId) {
  const skipped = opList.skipped_opinions || 0;

  if (skipped > 0) {
    const err = makeError(
      "selection_required",
      `Cluster ${clusterId}: ${skipped} opinion(s) could not be inspected. Cannot safely auto-select; retry or provide a known opinion_id.`,
    );
    err.opinions = opList.opinions;
    err.skipped_opinions = skipped;
    err.partial = true;
    err.cluster_id = clusterId;
    err.case_name = opList.case_name;
    return { error: err };
  }

  if (opList.opinions.length === 0) {
    return {
      error: makeError(
        "not_found",
        `Cluster ${clusterId} has no opinions.`,
      ),
    };
  }

  const leads = opList.opinions.filter((op) => LEAD_TYPES.has(op.type));
  if (leads.length === 1) {
    return { opinionId: leads[0].opinion_id };
  }

  if (opList.opinions.length === 1) {
    return { opinionId: opList.opinions[0].opinion_id };
  }

  const err = makeError(
    "selection_required",
    `Cluster ${clusterId} has ${opList.opinions.length} opinions. Specify opinion_id.`,
  );
  err.opinions = opList.opinions;
  err.cluster_id = clusterId;
  err.case_name = opList.case_name;
  return { error: err };
}
