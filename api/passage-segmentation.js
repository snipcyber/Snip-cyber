// Split source blocks into sentence-sized retrieval passages without assuming
// English capitalization. Intl.Segmenter handles multilingual punctuation and
// common abbreviations more reliably than a capital-letter-only regex.
const sentenceSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "sentence" })
  : null;

export function splitIntoPassages(value) {
  const text = String(value || "").replace(/\\s+/g, " ").trim();
  if (!text) return [];

  const segments = sentenceSegmenter
    ? Array.from(sentenceSegmenter.segment(text), item => item.segment)
    : text.split(/(?<=[.!?。！？])\\s+(?=[\\p{L}\\p{N}"“‘(])/u);

  return segments.map(segment => segment.trim()).filter(Boolean);
}
