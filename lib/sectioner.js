const HEADER_MAP = {
  background: /background|factual\s+history|statement\s+of\s+facts/i,
  procedural_history: /procedural\s+(history|background|posture)/i,
  standard_of_review: /standard\s+of\s+review/i,
  analysis: /discussion|analysis|merits/i,
  conclusion: /conclusion|order|disposition/i,
};

const HEADER_RE = /^(?:[IVX]+\.\s*|[A-Z]\.\s*|\d+\.\s*)?([A-Z][A-Z\s]+)$/;

const PHRASE_PATTERNS = [
  { section: "holding", re: /\bwe\s+hold\s+that\b|\bwe\s+conclude\b|\bwe\s+affirm\b|\bwe\s+reverse\b|\bit\s+is\s+ordered\b/i },
  { section: "standard_of_review", re: /\breview\s+de\s+novo\b|\babuse\s+of\s+discretion\b|\bclearly\s+erroneous\b|\bstandard\s+of\s+review\b/i },
  { section: "analysis", re: /\bwe\s+turn\s+to\b|\bthe\s+question\s+before\s+us\b|\bwe\s+consider\s+whether\b|\bwe\s+address\b|\bwe\s+examine\b/i },
  { section: "facts", re: /\bthe\s+facts\s+are\b|\bfactual\s+background\b|\bthe\s+following\s+facts\b/i },
  { section: "procedural_history", re: /\bappeal\s+from\b|\bpetition\s+for\s+review\b|\bremoved\s+to\b/i },
  { section: "dissent", re: /\bdissenting\b|\bI\s+respectfully\s+dissent\b/i },
  { section: "concurrence", re: /\bconcurring\b|\bI\s+join\s+the\s+majority\s+but\s+write\s+separately\b/i },
];

function detectHeader(text) {
  const m = text.match(HEADER_RE);
  if (!m) return null;
  const heading = m[1] || text;
  for (const [section, re] of Object.entries(HEADER_MAP)) {
    if (re.test(heading)) return section;
  }
  return null;
}

function detectPhrase(text) {
  for (const { section, re } of PHRASE_PATTERNS) {
    if (re.test(text)) return section;
  }
  return null;
}

export function labelSections(paragraphs) {
  let currentHeader = null;
  return paragraphs.map((p) => {
    const header = detectHeader(p.text);
    if (header) {
      currentHeader = header;
      return { ...p, section: header };
    }
    if (currentHeader) return { ...p, section: currentHeader };
    const phrase = detectPhrase(p.text);
    return { ...p, section: phrase || "unlabeled" };
  });
}
