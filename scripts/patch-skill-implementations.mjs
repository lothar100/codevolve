/**
 * Patches skill implementations in DynamoDB to add missing return statements.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-2" }));
const TABLE = "codevolve-skills";

const patches = [
  {
    id: "8dc7b994-0068-471a-9b89-ad1b5d6b626d",
    name: "word-frequency-map",
    append: "\nreturn { frequency: wordFrequency(text) };",
  },
  {
    id: "97b73cc9-1219-43ea-a475-a869ff340836",
    name: "chunk-document-for-embedding",
    append: "\nreturn { chunks: chunkDocument(document, chunkTokens, overlapTokens) };",
  },
  {
    id: "c57546be-e405-4bcc-8d97-0b3f137da4a8",
    name: "Group Array of Objects by Key",
    append: "\nreturn { result: groupByKey(items, key) };",
  },
  {
    id: "c5f5b466-eee8-4d23-abd3-52eec715d3da",
    name: "wrap-text-at-column",
    append: "\nreturn { wrapped: wrapText(text, columnWidth) };",
  },
  {
    id: "624a9a36-783f-497e-9a4f-33814a9d0604",
    name: "extract-json-from-llm-response",
    append: "\nreturn { data: extractJsonFromLlmResponse(response, defaultValue) };",
  },
  {
    id: "d060a101-b628-408f-b502-929f5796d944",
    name: "Zip Arrays into Array of Tuples",
    append: "\nreturn { result: zipArrays(arrays) };",
  },
  {
    id: "b090e6f8-2313-4c68-bab3-08009ced9987",
    name: "truncate-string-ellipsis",
    append: "\nreturn { result: truncateString(str, maxLength) };",
  },
  {
    id: "b1816206-1922-4c65-9383-1c6c9c568b65",
    name: "Binary Search on Sorted Array",
    append: "\nreturn { index: binarySearch(arr, target, mode) };",
  },
  {
    id: "4ffd82d7-f0fe-4879-861d-d7e4cfadba22",
    name: "topk-cosine-similarity",
    append: "\nreturn { results: topKNearest(query, candidates, k) };",
  },
  {
    id: "8cc7043e-3f73-44ab-ae67-7650cf4bb50e",
    name: "pick-keys-from-object",
    // export default is stripped by runner; just need to call the function
    append: "\nreturn solution(obj, keys);",
  },
];

// Fetch current implementation then update
import { GetCommand } from "@aws-sdk/lib-dynamodb";

for (const patch of patches) {
  const get = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { skill_id: patch.id, version_number: 1 },
  }));
  const current = get.Item?.implementation ?? "";
  const updated = current + patch.append;

  await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { skill_id: patch.id, version_number: 1 },
    UpdateExpression: "SET implementation = :impl, updated_at = :now",
    ExpressionAttributeValues: {
      ":impl": updated,
      ":now": new Date().toISOString(),
    },
  }));
  console.log(`✓ ${patch.name}`);
}

console.log("\nDone. All implementations patched.");
