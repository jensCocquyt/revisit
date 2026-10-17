import type { MatchMethod } from "../contract.js";

export type PassageHit = { passageId: string; itemId: string };

export type RankedList = { method: MatchMethod; hits: PassageHit[] };

export type RankedItem = {
  itemId: string;
  passageId: string;
  score: number;
  matchedBy: MatchMethod[];
};

// Reciprocal rank fusion per passage; an item ranks by its best passage.
export function rankItems(lists: RankedList[]): RankedItem[] {
  const passages = new Map<string, PassageHit & { score: number }>();
  const methodsByItem = new Map<string, Set<MatchMethod>>();
  for (const { method, hits } of lists) {
    hits.forEach((hit, index) => {
      const passage = passages.get(hit.passageId) ?? { ...hit, score: 0 };
      passage.score += 1 / (fusionConstant + index + 1);
      passages.set(hit.passageId, passage);
      const methods = methodsByItem.get(hit.itemId) ?? new Set<MatchMethod>();
      methods.add(method);
      methodsByItem.set(hit.itemId, methods);
    });
  }
  const best = new Map<string, PassageHit & { score: number }>();
  for (const passage of passages.values()) {
    const current = best.get(passage.itemId);
    if (!current || passage.score > current.score) best.set(passage.itemId, passage);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .map((passage) => ({
      itemId: passage.itemId,
      passageId: passage.passageId,
      score: passage.score,
      matchedBy: methodOrder.filter((method) => methodsByItem.get(passage.itemId)?.has(method)),
    }));
}

const fusionConstant = 60;

const methodOrder: MatchMethod[] = ["words", "fragment", "meaning"];
