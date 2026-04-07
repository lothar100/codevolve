import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const client = new DynamoDBClient({ region: "us-east-2" });
const doc = DynamoDBDocumentClient.from(client);

const PROBLEM_ID = "029a6207-1079-421c-a334-0861c7a04331";
const SKILL_ID = randomUUID();
const NOW = new Date().toISOString();

const implementation = `
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { readFileSync, readdirSync } from "fs";
import { join, relative, extname } from "path";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".mjs":  "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".txt":  "text/plain",
  ".webmanifest": "application/manifest+json",
};

function walkDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((e) =>
    e.isDirectory() ? walkDir(join(dir, e.name)) : [join(dir, e.name)]
  );
}

function contentType(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

export async function handler(inputs) {
  const { bucketName, distributionId, buildDir, region } = inputs;

  const s3 = new S3Client({ region });
  const cf = new CloudFrontClient({ region: "us-east-1" });

  const files = walkDir(buildDir);

  await Promise.all(
    files.map((file) => {
      const key = relative(buildDir, file).replace(/\\\\/g, "/");
      const body = readFileSync(file);
      const cacheControl = key === "index.html"
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=31536000, immutable";
      return s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType(file),
          CacheControl: cacheControl,
        })
      );
    })
  );

  const inv = await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    })
  );

  return {
    filesUploaded: files.length,
    invalidationId: inv.Invalidation?.Id ?? "",
  };
}
`.trim();

const skill = {
  skill_id: SKILL_ID,
  version_number: 1,
  problem_id: PROBLEM_ID,
  name: "deploy-react-s3-cloudfront",
  description: "Syncs a Vite/React build output directory to an S3 bucket (with correct Content-Type and cache headers per file type) then creates a CloudFront invalidation to flush the CDN cache. Uses AWS SDK v3. O(n) in number of files, network-bound.",
  version_label: "0.1.0",
  is_canonical: false,
  status: "partial",
  language: "javascript",
  domain: ["aws", "infrastructure", "frontend"],
  tags: ["s3", "cloudfront", "deploy", "react", "vite", "cdn", "aws-sdk"],
  inputs: [
    { name: "bucketName",      type: "string" },
    { name: "distributionId",  type: "string" },
    { name: "buildDir",        type: "string" },
    { name: "region",          type: "string" },
  ],
  outputs: [
    { name: "filesUploaded",  type: "number" },
    { name: "invalidationId", type: "string" },
  ],
  examples: [
    {
      input:  { bucketName: "codevolve-frontend", distributionId: "EXXXXXXXXX", buildDir: "./frontend/dist", region: "us-east-2" },
      output: { filesUploaded: 12, invalidationId: "I2ABCDEFGHIJKL" },
    },
  ],
  tests: [
    {
      input:    { bucketName: "test-bucket", distributionId: "ETEST123", buildDir: "./dist", region: "us-east-1" },
      expected: { filesUploaded: 0, invalidationId: "MOCK" },
    },
    {
      input:    { bucketName: "prod-bucket", distributionId: "EPROD456", buildDir: "./frontend/dist", region: "us-east-2" },
      expected: { filesUploaded: 0, invalidationId: "MOCK" },
    },
  ],
  implementation,
  confidence: 0,
  latency_p50_ms: null,
  latency_p95_ms: null,
  created_at: NOW,
  updated_at: NOW,
};

await doc.send(new PutCommand({ TableName: "codevolve-skills", Item: skill }));
console.log(`Skill created: ${SKILL_ID}`);

// Increment skill_count on the problem
await doc.send(new UpdateCommand({
  TableName: "codevolve-problems",
  Key: { problem_id: PROBLEM_ID },
  UpdateExpression: "SET skill_count = skill_count + :one, updated_at = :now",
  ExpressionAttributeValues: { ":one": 1, ":now": NOW },
}));
console.log(`Problem skill_count incremented`);
console.log(`\nSkill ID: ${SKILL_ID}`);
console.log(`Problem ID: ${PROBLEM_ID}`);
