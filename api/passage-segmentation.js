// Split sentence-like passages without assuming that a sentence starts with
// an uppercase Latin letter. Preserve punctuation and support scripts that
// commonly omit spaces after sentence-ending marks.
export function splitIntoPassages(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  return text
    .split(/(?<=[.!?])\s+|(?<=[。！？])\s*/u)
    .map(segment => segment.trim())
    .filter(Boolean);
}
