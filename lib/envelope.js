export const FRAGMENT_PREFIX = "cl:";

export function fragmentId(opinionId, paragraphIndex) {
  return `${FRAGMENT_PREFIX}${opinionId}:p${paragraphIndex}`;
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
