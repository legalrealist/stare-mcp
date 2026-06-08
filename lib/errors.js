export function makeError(code, message, retryable = false) {
  return { code, message, retryable };
}

export function classifyHttpError(status, path) {
  if (status === 429) {
    return makeError("rate_limited", `CourtListener rate limit exceeded: ${path}. Retry after 60 seconds.`, true);
  }
  if (status === 404) {
    return makeError("not_found", `Not found: ${path}`, false);
  }
  if (status >= 500) {
    return makeError("upstream_unavailable", `CourtListener unavailable (${status}): ${path}`, true);
  }
  return makeError("upstream_error", `CourtListener error (${status}): ${path}`, false);
}
