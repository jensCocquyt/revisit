export type EmbedPurpose = "document" | "query";

export type Embed = (texts: string[], purpose: EmbedPurpose) => Promise<number[][]>;

export const embeddingDimensions = 1024;
