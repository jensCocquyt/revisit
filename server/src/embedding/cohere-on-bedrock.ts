import { type BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { type Embed, embeddingDimensions } from "./embed.js";

export function createCohereEmbed(client: BedrockRuntimeClient, modelId: string): Embed {
  return async (texts, purpose) => {
    const embeddings: number[][] = [];
    for (let start = 0; start < texts.length; start += maxTextsPerCall) {
      const command = new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          texts: texts.slice(start, start + maxTextsPerCall),
          input_type: purpose === "query" ? "search_query" : "search_document",
          embedding_types: ["float"],
          output_dimension: embeddingDimensions,
        }),
      });
      const response = await client.send(command);
      const parsed = responseSchema.parse(JSON.parse(new TextDecoder().decode(response.body)));
      embeddings.push(...parsed.embeddings.float);
    }
    return embeddings;
  };
}

const maxTextsPerCall = 96;

const responseSchema = z.object({
  embeddings: z.object({ float: z.array(z.array(z.number()).length(embeddingDimensions)) }),
});
