import { type Embed, embeddingDimensions } from "../src/embedding/embed.js";

// Character trigrams hashed into a unit vector: texts sharing spelling land close together.
export const fakeEmbed: Embed = async (texts) => texts.map(trigramVector);

function trigramVector(text: string): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  const padded = ` ${text.toLowerCase()} `;
  for (let start = 0; start + 3 <= padded.length; start++) {
    const bucket = fnv1a(padded.slice(start, start + 3)) % embeddingDimensions;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
