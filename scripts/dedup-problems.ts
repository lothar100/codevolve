/**
 * Dedup problems: scan the problems table, keep earliest created_at per name,
 * delete the rest.
 *
 * Run: npx tsx scripts/dedup-problems.ts
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-2" });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.PROBLEMS_TABLE ?? "codevolve-problems";

async function scanAll(): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TABLE,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      })
    );
    items.push(...((result.Items ?? []) as Array<Record<string, unknown>>));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

async function dedupProblems() {
  console.log("Scanning all problems...");
  const all = await scanAll();
  console.log(`Total items in table: ${all.length}`);

  // Group by name, keep earliest created_at
  const byName = new Map<string, Array<Record<string, unknown>>>();
  for (const item of all) {
    const name = item["name"] as string;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(item);
  }

  console.log(`Unique problem names: ${byName.size}`);

  const toDelete: Array<{ problem_id: string; name: string }> = [];
  let kept = 0;

  for (const [name, items] of byName) {
    // Sort by created_at ascending — keep the first (earliest)
    items.sort((a, b) => {
      const ta = (a["created_at"] as string) ?? "";
      const tb = (b["created_at"] as string) ?? "";
      return ta.localeCompare(tb);
    });

    // Keep first, delete the rest
    kept++;
    for (let i = 1; i < items.length; i++) {
      toDelete.push({ problem_id: items[i]["problem_id"] as string, name });
    }
  }

  console.log(`Keeping: ${kept} | Deleting: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log("Nothing to delete — table is already clean.");
    return;
  }

  let deleted = 0;
  for (const { problem_id, name } of toDelete) {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { problem_id },
      })
    );
    deleted++;
    if (deleted % 10 === 0) console.log(`  Deleted ${deleted}/${toDelete.length}...`);
  }

  console.log(`\nDone. Deleted ${deleted} duplicates. Table now has ${kept} unique problems.`);
}

dedupProblems().catch((err) => {
  console.error("Dedup failed:", err);
  process.exit(1);
});
