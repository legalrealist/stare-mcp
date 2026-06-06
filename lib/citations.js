import { extractCitations, isCaseCitation } from "eyecite-ts";

export function isCitation(query) {
  const trimmed = query.trim();
  const cites = extractCitations(trimmed).filter(isCaseCitation);
  if (cites.length !== 1) return false;
  const cite = cites[0];
  const matchLen = cite.matchedText?.length || 0;
  return matchLen / trimmed.length > 0.7;
}

export function parseCitation(query) {
  const cites = extractCitations(query.trim()).filter(isCaseCitation);
  if (cites.length === 0) return null;
  const c = cites[0];
  return {
    volume: c.volume,
    reporter: c.reporter,
    page: c.page,
    matchedText: c.matchedText,
  };
}
