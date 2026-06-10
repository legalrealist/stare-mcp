export const FRAGMENT_PREFIX = "cl:";

export function fragmentId(opinionId, paragraphIndex) {
  return `${FRAGMENT_PREFIX}${opinionId}:p${paragraphIndex}`;
}

export function parseFragmentId(id) {
  const m = /^cl:(\d+):p(\d+)$/.exec(id || "");
  if (!m) return null;
  return { opinion_id: Number(m[1]), paragraph: Number(m[2]) };
}

function buildProvenance(fields) {
  const prov = {
    source: "CourtListener",
    api_version: "v4",
    retrieved_at: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) prov[k] = v;
  }
  return prov;
}

export function successEnvelope(data, provenanceFields, pagination) {
  return {
    data,
    provenance: buildProvenance(provenanceFields),
    pagination: pagination || { next_cursor: null, has_more: false },
  };
}

export function errorEnvelope(error, provenanceFields) {
  return {
    error,
    provenance: buildProvenance(provenanceFields),
  };
}
