import { makeError } from "./errors.js";

const LEAD_TYPES = new Set(["lead", "plurality"]);

// opList comes from a single atomic listOpinions request, so it is always
// the complete opinion set for the cluster — auto-selection never acts on
// partial visibility.
export function resolveOpinionSelection(opList, clusterId) {
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
  return { error: err };
}
