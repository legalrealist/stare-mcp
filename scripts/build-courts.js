#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL =
  "https://raw.githubusercontent.com/freelawproject/courts-db/main/courts_db/data/courts.json";

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Failed to fetch courts-db: ${res.status}`);
const allCourts = await res.json();

// The FLP `level` field is inconsistently populated — many federal courts have
// level "".  We classify using a combination of id, name, and type instead.

const CIRCUIT_IDS = new Set([
  "ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9",
  "ca10", "ca11", "cadc", "cafc",
]);

function classifyLevel(court) {
  if (court.id === "scotus") return "scotus";
  if (CIRCUIT_IDS.has(court.id)) return "circuit";
  // District courts: FLP level "gjc", or name contains "District Court"
  // (some FLP entries have incorrect type/level, so name is most reliable).
  if (court.level === "gjc" || /district court/i.test(court.name)) {
    return "district";
  }
  return null; // skip bankruptcy, special, and other courts
}

// Build a lookup so we can infer appeal_to for districts that lack it.
// CourtListener conventions: district id encodes the state + compass, and the
// circuit mapping is well-known.  We hard-code the state→circuit map and fall
// back to the FLP appeal_to field when available.

const STATE_TO_CIRCUIT = {
  me: "ca1", ma: "ca1", nh: "ca1", pr: "ca1", ri: "ca1",
  ct: "ca2", ny: "ca2", vt: "ca2",
  de: "ca3", nj: "ca3", pa: "ca3", vi: "ca3",
  md: "ca4", nc: "ca4", sc: "ca4", va: "ca4", wv: "ca4",
  la: "ca5", ms: "ca5", tx: "ca5",
  ky: "ca6", mi: "ca6", oh: "ca6", tn: "ca6",
  il: "ca7", in: "ca7", wi: "ca7",
  ar: "ca8", ia: "ca8", mn: "ca8", mo: "ca8", nd: "ca8", ne: "ca8", sd: "ca8",
  ak: "ca9", az: "ca9", ca: "ca9", gu: "ca9", hi: "ca9", id: "ca9",
  mt: "ca9", nv: "ca9", or: "ca9", wa: "ca9", mp: "ca9",
  co: "ca10", ks: "ca10", nm: "ca10", ok: "ca10", ut: "ca10", wy: "ca10",
  al: "ca11", fl: "ca11", ga: "ca11",
  dc: "cadc",
};

/** Try to infer the circuit a district appeals to from its id. */
function inferCircuit(courtId) {
  // Strip trailing compass indicator (e, w, n, s, m, c, d) and 'd' for district.
  // Examples: cand → ca, nysd → ny (after dropping sd → nys → ny),
  //           txed → tx, ilnd → il, wvsd → wv
  // Strategy: try progressively shorter prefixes.
  const withoutD = courtId.replace(/d$/, ""); // e.g. "can", "nys"
  for (let len = withoutD.length; len >= 2; len--) {
    const prefix = withoutD.slice(0, len);
    if (STATE_TO_CIRCUIT[prefix]) return STATE_TO_CIRCUIT[prefix];
  }
  return undefined;
}

const federal = {};
for (const court of allCourts) {
  if (court.system !== "federal") continue;
  const level = classifyLevel(court);
  if (!level) continue;

  const entry = { name: court.name, level };

  if (level === "district") {
    const appealTo = court.appeal_to || inferCircuit(court.id);
    if (appealTo) entry.appeal_to = appealTo;
  }

  federal[court.id] = entry;
}

const outPath = join(__dirname, "..", "data", "courts.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(federal, null, 2) + "\n");

// Summary
const byLevel = { scotus: 0, circuit: 0, district: 0 };
for (const v of Object.values(federal)) byLevel[v.level]++;
console.log(
  `Wrote ${Object.keys(federal).length} federal courts to data/courts.json` +
    ` (${byLevel.scotus} SCOTUS, ${byLevel.circuit} circuit, ${byLevel.district} district)`
);
