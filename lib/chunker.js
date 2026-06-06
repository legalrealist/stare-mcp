export function chunk(text) {
  if (!text || !text.trim()) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text, index) => ({ index, text }));
}
