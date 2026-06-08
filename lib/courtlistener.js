import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyHttpError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);
const FEDERAL_COURT_IDS = Object.keys(courts).join(" ");

const BASE = "https://www.courtlistener.com/api/rest/v4";
const TIMEOUT_MS = 30_000;

function stripHtml(html) {
  return html
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

async function cl(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Token ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: classifyHttpError(res.status, url.toString()) };
  }
  return { data: await res.json() };
}

function clUrl(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url;
}

async function clPost(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return { error: classifyHttpError(res.status, url.toString()) };
  }
  return { data: await res.json() };
}

// CL opinion type codes → human-readable names
const OPINION_TYPE_MAP = {
  "010combined": "lead",
  "015unannotated": "lead",
  "020lead": "lead",
  "025plurality": "plurality",
  "030concurrence": "concurrence",
  "035concurrenceinpart": "concurrence",
  "040dissent": "dissent",
  "050addendum": "addendum",
  "060remittitur": "remittitur",
  "070rehearing": "rehearing",
  "080onbandon": "on_bandon",
  "090trialcourt": "trial_court",
};

function normalizeOpinionType(clType) {
  return OPINION_TYPE_MAP[clType] || clType || "unknown";
}

function caseSourceUrl(clusterId, caseName) {
  const slug = (caseName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.courtlistener.com/opinion/${clusterId}/${slug}/`;
}

export async function searchCases(query, token, { cursor } = {}) {
  const url = cursor
    ? new URL(cursor)
    : clUrl("/search/", {
        q: query,
        type: "o",
        order_by: "score desc",
        court: FEDERAL_COURT_IDS,
        stat_Published: "on",
        stat_Precedential: "on",
      });

  const result = await cl(url, token);
  if (result.error) return result;

  const raw = result.data;
  const cases = (raw.results || []).map((r) => ({
    cluster_id: r.cluster_id,
    case_name: r.caseName || r.case_name,
    citation: (r.citation || [])[0] || null,
    court_id: r.court_id || r.court,
    date_filed: r.dateFiled || r.date_filed,
    status: r.status,
    snippet: r.snippet,
    source_url: caseSourceUrl(r.cluster_id, r.caseName || r.case_name),
  }));

  return { cases, next_cursor: raw.next || null };
}

export async function lookupCitation(citationText, token) {
  const url = `${BASE}/citation-lookup/`;
  const result = await clPost(url, token, `text=${encodeURIComponent(citationText)}`);
  if (result.error) return result;

  const raw = Array.isArray(result.data) ? result.data : [];
  const clusters = raw.flatMap((r) => (r.clusters || []).map((c) => ({
    ...c,
    citation_matched: r.citation,
  })));

  return { clusters };
}

export async function listOpinions(clusterId, token) {
  const result = await cl(clUrl(`/clusters/${clusterId}/`), token);
  if (result.error) return result;

  const cluster = result.data;
  const opinionUrls = cluster.sub_opinions || [];

  // Fetch metadata for each sub-opinion (type, author)
  const opinions = [];
  for (const rawUrl of opinionUrls) {
    const opUrl = typeof rawUrl === "string" ? rawUrl : rawUrl.resource_uri;
    const opId = opUrl.match(/opinions\/(\d+)/)?.[1];
    if (!opId) continue;

    const opResult = await cl(new URL(opUrl), token);
    if (opResult.error) continue; // skip individual failures
    const op = opResult.data;
    opinions.push({
      opinion_id: Number(opId),
      type: normalizeOpinionType(op.type),
      author: op.author || null,
    });
  }

  return {
    cluster_id: clusterId,
    case_name: cluster.case_name,
    date_filed: cluster.date_filed,
    opinions,
  };
}

export async function fetchOpinionText(opinionId, token) {
  const result = await cl(clUrl(`/opinions/${opinionId}/`), token);
  if (result.error) return result;

  const op = result.data;
  let text = op.plain_text || "";
  if (!text && op.html_with_citations) {
    text = stripHtml(op.html_with_citations);
  }

  return {
    opinion_id: Number(op.id || opinionId),
    type: normalizeOpinionType(op.type),
    author: op.author || null,
    text,
  };
}
