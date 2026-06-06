import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courts = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "courts.json"), "utf-8")
);

export function getTier(courtId, circuit) {
  const court = courts[courtId];
  if (!court) return 5;
  if (court.level === "scotus") return 1;
  if (court.level === "circuit") {
    if (!circuit) return 3;
    return courtId === circuit ? 2 : 3;
  }
  return 4;
}

export function rankByAuthority(results, circuit) {
  return results
    .map((r) => ({ ...r, tier: getTier(r.court_id, circuit) }))
    .sort((a, b) => a.tier - b.tier || (b.date_filed || "").localeCompare(a.date_filed || ""));
}
