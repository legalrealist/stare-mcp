const KEEP_SECTIONS = new Set(["holding", "analysis", "standard_of_review"]);

export function filterFragments(fragments) {
  const kept = fragments.filter((f) => KEEP_SECTIONS.has(f.section));
  return { kept, droppedCount: fragments.length - kept.length };
}

export function assembleResponse(opinions, { query, circuit }) {
  if (opinions.length === 0) {
    return "[NO_AUTHORITY_FOUND] No opinions matched this query. This means the search failed — not that no authority exists. Try rephrasing or broadening the query.";
  }

  const failed = opinions.filter((op) => op.fragments[0]?.section === "error");
  const succeeded = opinions.filter((op) => op.fragments[0]?.section !== "error");

  const tiers = new Map();
  for (const op of opinions) {
    if (!tiers.has(op.tier)) tiers.set(op.tier, []);
    tiers.get(op.tier).push(op);
  }

  const lines = [];
  for (const [tier, ops] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
    const label = ops[0].tierLabel;
    lines.push(`## Tier ${tier} · ${label}\n`);

    for (const op of ops) {
      lines.push(`### ${op.case_name}${op.citation ? `, ${op.citation}` : ""}`);
      lines.push(`**Court:** ${op.court_name} · **Decided:** ${op.date_filed}\n`);

      for (const f of op.fragments) {
        lines.push(`> [${f.section} — heuristic] ${f.text}\n`);
      }
      lines.push("---\n");
    }
  }

  const totalFragments = opinions.reduce((n, op) => n + (op.totalFragments || 0), 0);
  const shownFragments = succeeded.reduce((n, op) => n + op.fragments.length, 0);
  const extra = totalFragments - shownFragments;

  const fetchNote = failed.length > 0
    ? `*Retrieved ${succeeded.length} of ${opinions.length} opinions (${failed.length} failed: likely rate-limited).*`
    : `*Showing holding/analysis fragments from ${opinions.length} opinions.*`;
  lines.push(fetchNote);
  if (extra > 0) {
    lines.push(`*${extra} additional fragments available (facts, procedural history, etc.).*`);
  }
  lines.push("*Section labels are heuristic — verify against the full opinion before citing.*");
  lines.push("");

  if (opinions[0]?.citation) {
    lines.push(`*To read a full opinion: \`research("${opinions[0].citation}")\`*`);
  }
  if (circuit) {
    const otherCircuit = circuit === "ca9" ? "ca2" : "ca9";
    lines.push(`*To check another circuit: \`research("${query}", circuit: "${otherCircuit}")\`*`);
  }

  return lines.join("\n");
}
