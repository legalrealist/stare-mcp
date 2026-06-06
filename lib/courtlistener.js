import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);
const FEDERAL_COURT_IDS = Object.keys(courts).join(" ");

const BASE = "https://www.courtlistener.com/api/rest/v4";

async function cl(path, token, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) {
    throw new Error(`CL API ${res.status}: ${path}`);
  }
  return res.json();
}

export async function searchOpinions(query, token, { count = 10 } = {}) {
  const data = await cl("/search/", token, {
    q: query,
    type: "o",
    order_by: "score desc",
    court: FEDERAL_COURT_IDS,
  });
  return (data.results || []).slice(0, count).map((r) => ({
    cluster_id: r.cluster_id,
    case_name: r.caseName || r.case_name,
    citation: (r.citation || [])[0] || null,
    court_id: r.court_id || r.court,
    date_filed: r.dateFiled || r.date_filed,
    status: r.status,
    snippet: r.snippet,
  }));
}

export async function fetchOpinion(clusterId, token) {
  const cluster = await cl(`/clusters/${clusterId}/`, token);
  const opinionUrls = cluster.sub_opinions || [];
  if (opinionUrls.length === 0) return null;

  const opinionUrl = typeof opinionUrls[0] === "string"
    ? opinionUrls[0]
    : opinionUrls[0].resource_uri;
  const opinionId = opinionUrl.match(/opinions\/(\d+)/)?.[1];
  if (!opinionId) return null;

  const opinion = await cl(`/opinions/${opinionId}/`, token);
  let text = opinion.plain_text || "";
  if (!text && opinion.html_with_citations) {
    text = opinion.html_with_citations
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  return { text, type: opinion.type };
}

export async function lookupCitation(citationText, token) {
  const res = await fetch(`${BASE}/citation-lookup/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `text=${encodeURIComponent(citationText)}`,
  });
  if (!res.ok) {
    throw new Error(`CL API ${res.status}: /citation-lookup/`);
  }
  const data = await res.json();
  // Response is [{citation, clusters: [{id, case_name, sub_opinions, ...}]}]
  const results = Array.isArray(data) ? data : [];
  return results.flatMap((r) => r.clusters || []);
}
