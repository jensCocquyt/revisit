export function splitIntoPassages(text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? splitAtLevel(trimmed, 0) : [];
}

// About 300 tokens.
export const maxPassageLength = 1200;

const levels = [
  { separator: /\n\s*\n/, joiner: "\n\n" },
  { separator: /\n/, joiner: "\n" },
  { separator: /(?<=[.!?])\s+/, joiner: " " },
  { separator: /\s+/, joiner: " " },
];

function splitAtLevel(text: string, level: number): string[] {
  if (text.length <= maxPassageLength) return [text];
  const rule = levels[level];
  if (!rule) return hardSplit(text);
  const pieces = text
    .split(rule.separator)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .flatMap((piece) => splitAtLevel(piece, level + 1));
  return mergeUpToLimit(pieces, rule.joiner);
}

function mergeUpToLimit(pieces: string[], joiner: string): string[] {
  const merged: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + joiner.length + piece.length > maxPassageLength) {
      merged.push(current);
      current = "";
    }
    current = current ? `${current}${joiner}${piece}` : piece;
  }
  if (current) merged.push(current);
  return merged;
}

function hardSplit(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += maxPassageLength) {
    chunks.push(text.slice(start, start + maxPassageLength));
  }
  return chunks;
}
