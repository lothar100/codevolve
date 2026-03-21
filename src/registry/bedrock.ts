/**
 * Bedrock Titan v2 embedding generation helper.
 *
 * Generates 1024-dimension embeddings for skill discovery via /resolve.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

/**
 * Generate an embedding vector from text using Amazon Titan Embed Text v2.
 * Returns a 1024-dimension number array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: "amazon.titan-embed-text-v2:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: 1024,
        normalize: true,
      }),
    }),
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.embedding as number[];
}

/**
 * Build the text input for embedding from skill fields.
 */
export function buildEmbeddingText(fields: {
  name: string;
  description: string;
  domain: string[];
  tags: string[];
}): string {
  const parts = [
    fields.name,
    fields.description,
    `domains: ${fields.domain.join(", ")}`,
  ];
  if (fields.tags.length > 0) {
    parts.push(`tags: ${fields.tags.join(", ")}`);
  }
  return parts.join("\n");
}

export { bedrockClient };
