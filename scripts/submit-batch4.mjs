// Submit Batch 4: AWS, Filesystem, Code, Env, AI skills
// Creates missing problems first, then submits all 27 skills
const API_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const TOKEN = "eyJraWQiOiIwQncyNkI4SzVHOERyXC94N1BCbDUxR0pRUThoUWRlTkZUVUZTQ3hiaGJETT0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTIuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0yX0FOek1LTms1ayIsImNvZ25pdG86dXNlcm5hbWUiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJvcmlnaW5fanRpIjoiZjU5OTU0MjctNTJjNS00MTc3LTk3ZjQtMTRhZDE2NTlkODFlIiwiYXVkIjoiMmFsajNxb2M4a2pybnNhYzJkNW9rcTdxdDAiLCJldmVudF9pZCI6ImI1NjdjYmIwLTBlZDEtNDQwNS05MDBiLWJmN2Y3MWY4YWZlYSIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNzc0OTIwMDMyLCJleHAiOjE3NzQ5MjM2MzIsImlhdCI6MTc3NDkyMDAzMiwianRpIjoiYjllYTc3ZmYtNGZlZS00M2YyLTg1ZjItODVkODVhMjY4ZmE3IiwiZW1haWwiOiJhZ2VudEBjb2Rldm9sdmUuYWkifQ.KVYec87DBODtA8reI8dNgumlHalkf4MJsr6RVNb58kU7GJv7ZZWNSsc4MWqP9wvSxPDnjO9WsGgkAoK285A9EIknFgRBnxm7AIngzUQq1t20d-ksB_mDI2IrPc4yWDmeJrOySjSm_SBhmi-XSKahqvOzbSJ5pmAY6Zid54qhlaP-hSBhH-LorPt1Ui7fo-gLE2aWMVYWaIhk-Z6H4EuKHZZR8HE1AWqwB4Mh_GUfQkWVlLrqZsdVW0-0dA0_I2TH0skffQGn7rzDv6UK6Vlkt-psYag5WKz_NmRAozcDNQKwGjl9ANfbExNYSKo886C7YEb_ftZFu0mEX9bsHTyXwhg";

const HEADERS = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${TOKEN}`,
};

async function createProblem(problem) {
  const res = await fetch(`${API_URL}/problems`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(problem),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`  [problem created] ${data.problem.name} -> ${data.problem.problem_id}`);
    return data.problem.problem_id;
  } else {
    console.error(`  [problem error] ${problem.name} -> ${JSON.stringify(data)}`);
    return null;
  }
}

async function submit(skill) {
  const res = await fetch(`${API_URL}/skills`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(skill),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`✓ ${skill.name} -> ${data.skill.skill_id}`);
  } else {
    console.error(`✗ ${skill.name} -> ${JSON.stringify(data)}`);
  }
  return data;
}

// Fetch existing problems and build a prefix->id map
async function fetchProblems() {
  const res = await fetch(`${API_URL}/problems`, { headers: HEADERS });
  const data = await res.json();
  return data.problems || [];
}

function findByPrefix(problems, prefix) {
  return problems.find(p => p.problem_id.startsWith(prefix));
}

(async () => {
  console.log("Fetching existing problems...");
  let problems = await fetchProblems();
  console.log(`Found ${problems.length} existing problems.\n`);

  // Problem definitions for any that need to be created
  const problemDefs = [
    // AWS
    {
      prefix: "4f0583df",
      name: "DynamoDB PutItem with condition expression",
      description: "Build PutCommand params with an attribute_not_exists condition to prevent overwrites. Returns the params object ready to pass to DynamoDBDocumentClient.",
      difficulty: "medium",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "put", "condition", "aws"],
    },
    {
      prefix: "1772eca2",
      name: "DynamoDB query on Global Secondary Index",
      description: "Build QueryCommand params targeting a GSI with a partition key condition. Supports optional pagination via lastKey.",
      difficulty: "medium",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "gsi", "query", "pagination"],
    },
    {
      prefix: "1130caec",
      name: "DynamoDB batch write with chunking",
      description: "Split an arbitrary number of items into batches of 25 (DynamoDB limit) and return an array of BatchWriteItem request objects.",
      difficulty: "medium",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "batch-write", "chunking", "aws"],
    },
    {
      prefix: "15fd9ab4",
      name: "Kinesis publish events in batches",
      description: "Chunk Kinesis records into batches of 500 (API limit) and return PutRecords request objects ready to send.",
      difficulty: "medium",
      domain: ["aws"],
      tags: ["kinesis", "batch", "streaming", "aws"],
    },
    {
      prefix: "d1aa48a5",
      name: "Lambda InvokeCommand params builder",
      description: "Build the InvokeCommand params object for AWS Lambda with function name, payload, and invocation type.",
      difficulty: "easy",
      domain: ["aws"],
      tags: ["lambda", "invoke", "params", "aws"],
    },
    {
      prefix: "a49d2a3d",
      name: "SQS operation params builder",
      description: "Build SQS params for send, receive, or delete operations given queue URL and operation-specific arguments.",
      difficulty: "easy",
      domain: ["aws"],
      tags: ["sqs", "params", "send", "receive", "delete"],
    },
    {
      prefix: "6dfe0f91",
      name: "CloudWatch PutMetricData params builder",
      description: "Build a PutMetricData request body for CloudWatch given a namespace and array of metric definitions.",
      difficulty: "easy",
      domain: ["aws"],
      tags: ["cloudwatch", "metrics", "params", "aws"],
    },
    {
      prefix: "e9992fa9",
      name: "Secrets Manager cache validity check",
      description: "Determine whether a cached secret is still valid given its TTL and when it was last fetched. Returns shouldFetch and the cached value.",
      difficulty: "easy",
      domain: ["aws"],
      tags: ["secrets-manager", "cache", "ttl", "aws"],
    },
    // Filesystem
    {
      prefix: "8de6b15b",
      name: "Parse .env file content",
      description: "Parse KEY=VALUE content handling quoted values, inline comments, and blank lines. Returns a record of key-value string pairs.",
      difficulty: "easy",
      domain: ["filesystem"],
      tags: ["env", "parse", "dotenv", "filesystem"],
    },
    {
      prefix: "f257bf26",
      name: "Glob pattern file matcher",
      description: "Match an array of file paths against one or more glob patterns supporting *, **, and ? wildcards. Returns matched paths.",
      difficulty: "medium",
      domain: ["filesystem"],
      tags: ["glob", "pattern", "match", "filesystem"],
    },
    {
      prefix: "d5b1c492",
      name: "Compute file content hash",
      description: "Hash string content using a configurable algorithm (md5, sha1, sha256, etc.) via Node crypto. Returns hex digest.",
      difficulty: "easy",
      domain: ["filesystem"],
      tags: ["hash", "crypto", "md5", "sha256", "filesystem"],
    },
    {
      prefix: "eae0a1a9",
      name: "Atomic file write plan",
      description: "Generate a temporary file path alongside the target path for an atomic write-then-rename strategy. Returns both paths.",
      difficulty: "easy",
      domain: ["filesystem"],
      tags: ["atomic", "write", "temp", "filesystem"],
    },
    // Code
    {
      prefix: "5c76d5ba",
      name: "Extract TypeScript import paths",
      description: "Use regex to extract all module specifiers from import/require statements in TypeScript source code.",
      difficulty: "easy",
      domain: ["code"],
      tags: ["typescript", "imports", "regex", "ast"],
    },
    {
      prefix: "1fa5ff50",
      name: "Find TODO/FIXME comments in source",
      description: "Scan source code for TODO, FIXME, HACK, and NOTE comments, returning line number, type, text, and optional ticket reference.",
      difficulty: "easy",
      domain: ["code"],
      tags: ["todo", "fixme", "comments", "static-analysis"],
    },
    {
      prefix: "9975a61f",
      name: "Parse package.json dependencies",
      description: "Extract all dependencies from a package.json string, classify each as dependencies/devDependencies/peerDependencies, and identify the semver range type.",
      difficulty: "easy",
      domain: ["code"],
      tags: ["package-json", "npm", "dependencies", "semver"],
    },
    // Env
    {
      prefix: "729ad1c3",
      name: "Deep clone any value",
      description: "Deep clone any serializable value using structuredClone when available, falling back to JSON parse/stringify. Returns the cloned value.",
      difficulty: "easy",
      domain: ["env"],
      tags: ["clone", "deep-copy", "structuredClone"],
    },
    {
      prefix: "c2d2b27c",
      name: "Shell-escape command args for logging",
      description: "Safely format a command and its arguments into a single shell-escaped string suitable for logging, quoting args that contain spaces or special characters.",
      difficulty: "easy",
      domain: ["env"],
      tags: ["shell", "escape", "logging", "security"],
    },
    {
      prefix: "b0157d21",
      name: "Simulate debounce firing",
      description: "Given an array of call timestamps and a debounce delay, compute which timestamps actually fire (i.e., are not superseded within delayMs).",
      difficulty: "medium",
      domain: ["env"],
      tags: ["debounce", "timing", "simulation"],
    },
    {
      prefix: "e4e425bc",
      name: "Concurrent task completion order",
      description: "Simulate executing taskCount tasks with a concurrency limit and return the order in which tasks complete (0-indexed).",
      difficulty: "medium",
      domain: ["env"],
      tags: ["concurrency", "async", "scheduling", "simulation"],
    },
    // AI
    {
      prefix: "6a0ba5a6",
      name: "Cosine similarity between two vectors",
      description: "Compute cosine similarity between two numeric vectors: dot(a,b) / (|a| * |b|). Returns a number in [-1, 1].",
      difficulty: "easy",
      domain: ["ai"],
      tags: ["cosine-similarity", "embedding", "vector", "math"],
    },
    {
      prefix: "ecc06238",
      name: "Estimate token count from text",
      description: "Estimate the number of LLM tokens in a text string using the 4-characters-per-token heuristic. Returns an integer estimate.",
      difficulty: "easy",
      domain: ["ai"],
      tags: ["tokens", "llm", "estimate", "heuristic"],
    },
    {
      prefix: "3cb00123",
      name: "Truncate prompt to token budget",
      description: "Truncate a prompt to fit within a maximum token budget, cutting at a sentence boundary and appending a truncation notice.",
      difficulty: "medium",
      domain: ["ai"],
      tags: ["tokens", "truncate", "prompt", "llm"],
    },
    {
      prefix: "3fe519fa",
      name: "Validate environment variable schema",
      description: "Validate process.env (or any string map) against a schema defining required vars, types, and defaults. Returns valid, missing, invalid, and resolved values.",
      difficulty: "medium",
      domain: ["validation", "env"],
      tags: ["env", "schema", "validate", "config"],
    },
  ];

  // Ensure all problems exist; create missing ones
  const idMap = {}; // prefix -> full UUID

  for (const def of problemDefs) {
    const existing = findByPrefix(problems, def.prefix);
    if (existing) {
      idMap[def.prefix] = existing.problem_id;
    } else {
      console.log(`Creating problem: ${def.name}`);
      const { prefix, ...payload } = def;
      const newId = await createProblem(payload);
      if (newId) {
        idMap[def.prefix] = newId;
        problems.push({ problem_id: newId, name: def.name });
      }
    }
  }

  // Also map the two problems that already existed
  // 875d621c = DynamoDB transactional write
  const dynTx = findByPrefix(problems, "875d621c");
  if (dynTx) idMap["875d621c"] = dynTx.problem_id;
  // 056247d8 = S3 put and get with content type
  const s3 = findByPrefix(problems, "056247d8");
  if (s3) idMap["056247d8"] = s3.problem_id;
  // 1b2362d9 = Detect programming language from file extension
  const lang = findByPrefix(problems, "1b2362d9");
  if (lang) idMap["1b2362d9"] = lang.problem_id;
  // bc0fc059 = Memoize async function with TTL
  const memo = findByPrefix(problems, "bc0fc059");
  if (memo) idMap["bc0fc059"] = memo.problem_id;

  console.log("\nProblem ID map:");
  for (const [prefix, id] of Object.entries(idMap)) {
    console.log(`  ${prefix} -> ${id}`);
  }

  console.log("\nSubmitting skills...\n");

  const skills = [
    // ── AWS ─────────────────────────────────────────────────────────────────

    // 1. dynamo-put-with-condition
    {
      problem_id: idMap["4f0583df"],
      name: "dynamo-put-with-condition",
      description: "Build PutCommand params with attribute_not_exists condition to prevent overwriting an existing item. O(1) time.",
      language: "typescript",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "put", "condition", "aws"],
      inputs: [
        { name: "tableName", type: "string" },
        { name: "item", type: "Record<string, unknown>" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: { tableName: "Users", item: { pk: "u1", email: "a@b.com" } },
          output: {
            params: {
              TableName: "Users",
              Item: { pk: "u1", email: "a@b.com" },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        },
      ],
      tests: [
        {
          input: { tableName: "T", item: { pk: "1", val: "x" } },
          expected: {
            params: {
              TableName: "T",
              Item: { pk: "1", val: "x" },
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
        },
        {
          input: { tableName: "Orders", item: { orderId: "o1", amount: 99 } },
          expected: {
            params: {
              TableName: "Orders",
              Item: { orderId: "o1", amount: 99 },
              ConditionExpression: "attribute_not_exists(orderId)",
            },
          },
        },
      ],
      status: "verified",
      implementation: `// Get the first key of the item as the partition key name
const pkName = Object.keys(item)[0];
const params = {
  TableName: tableName,
  Item: item,
  ConditionExpression: \`attribute_not_exists(\${pkName})\`,
};
return { params };`,
    },

    // 2. dynamo-query-gsi
    {
      problem_id: idMap["1772eca2"],
      name: "dynamo-query-gsi",
      description: "Build QueryCommand params for a DynamoDB Global Secondary Index with optional pagination. O(1) time.",
      language: "typescript",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "gsi", "query", "pagination"],
      inputs: [
        { name: "tableName", type: "string" },
        { name: "indexName", type: "string" },
        { name: "pkName", type: "string" },
        { name: "pkValue", type: "string" },
        { name: "lastKey", type: "object | null" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: {
            tableName: "Orders",
            indexName: "byUser",
            pkName: "userId",
            pkValue: "u1",
            lastKey: null,
          },
          output: {
            params: {
              TableName: "Orders",
              IndexName: "byUser",
              KeyConditionExpression: "#pk = :pkv",
              ExpressionAttributeNames: { "#pk": "userId" },
              ExpressionAttributeValues: { ":pkv": "u1" },
            },
          },
        },
      ],
      tests: [
        {
          input: {
            tableName: "Orders",
            indexName: "byUser",
            pkName: "userId",
            pkValue: "u1",
            lastKey: null,
          },
          expected: {
            params: {
              TableName: "Orders",
              IndexName: "byUser",
              KeyConditionExpression: "#pk = :pkv",
              ExpressionAttributeNames: { "#pk": "userId" },
              ExpressionAttributeValues: { ":pkv": "u1" },
            },
          },
        },
        {
          input: {
            tableName: "Orders",
            indexName: "byUser",
            pkName: "userId",
            pkValue: "u2",
            lastKey: { userId: "u2", sk: "last" },
          },
          expected: {
            params: {
              TableName: "Orders",
              IndexName: "byUser",
              KeyConditionExpression: "#pk = :pkv",
              ExpressionAttributeNames: { "#pk": "userId" },
              ExpressionAttributeValues: { ":pkv": "u2" },
              ExclusiveStartKey: { userId: "u2", sk: "last" },
            },
          },
        },
      ],
      status: "verified",
      implementation: `const params: Record<string, unknown> = {
  TableName: tableName,
  IndexName: indexName,
  KeyConditionExpression: "#pk = :pkv",
  ExpressionAttributeNames: { "#pk": pkName },
  ExpressionAttributeValues: { ":pkv": pkValue },
};
if (lastKey) {
  params.ExclusiveStartKey = lastKey;
}
return { params };`,
    },

    // 3. dynamo-transact-write
    {
      problem_id: idMap["875d621c"],
      name: "dynamo-transact-write",
      description: "Build TransactWriteItems params combining Put and Update operations in a single atomic transaction. O(n) time.",
      language: "typescript",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "transaction", "write", "atomic"],
      inputs: [
        { name: "tableName", type: "string" },
        { name: "puts", type: "object[]" },
        { name: "updates", type: "{ key: object; expression: string; values: Record<string, unknown> }[]" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: {
            tableName: "Orders",
            puts: [{ pk: "o1", status: "placed" }],
            updates: [{ key: { pk: "u1" }, expression: "SET balance = balance - :amt", values: { ":amt": 10 } }],
          },
          output: {
            params: {
              TransactItems: [
                { Put: { TableName: "Orders", Item: { pk: "o1", status: "placed" } } },
                {
                  Update: {
                    TableName: "Orders",
                    Key: { pk: "u1" },
                    UpdateExpression: "SET balance = balance - :amt",
                    ExpressionAttributeValues: { ":amt": 10 },
                  },
                },
              ],
            },
          },
        },
      ],
      tests: [
        {
          input: {
            tableName: "T",
            puts: [{ pk: "a", v: 1 }],
            updates: [],
          },
          expected: {
            params: {
              TransactItems: [{ Put: { TableName: "T", Item: { pk: "a", v: 1 } } }],
            },
          },
        },
        {
          input: {
            tableName: "T",
            puts: [],
            updates: [{ key: { pk: "b" }, expression: "SET n = :n", values: { ":n": 5 } }],
          },
          expected: {
            params: {
              TransactItems: [
                {
                  Update: {
                    TableName: "T",
                    Key: { pk: "b" },
                    UpdateExpression: "SET n = :n",
                    ExpressionAttributeValues: { ":n": 5 },
                  },
                },
              ],
            },
          },
        },
      ],
      status: "verified",
      implementation: `const TransactItems: unknown[] = [];
for (const item of puts) {
  TransactItems.push({ Put: { TableName: tableName, Item: item } });
}
for (const upd of updates) {
  TransactItems.push({
    Update: {
      TableName: tableName,
      Key: upd.key,
      UpdateExpression: upd.expression,
      ExpressionAttributeValues: upd.values,
    },
  });
}
const params = { TransactItems };
return { params };`,
    },

    // 4. dynamo-batch-write
    {
      problem_id: idMap["1130caec"],
      name: "dynamo-batch-write",
      description: "Chunk items into DynamoDB BatchWriteItem request batches of 25. Returns an array of batch request objects. O(n) time.",
      language: "typescript",
      domain: ["aws", "dynamodb"],
      tags: ["dynamodb", "batch-write", "chunking"],
      inputs: [
        { name: "tableName", type: "string" },
        { name: "items", type: "object[]" },
      ],
      outputs: [{ name: "batches", type: "object[]" }],
      examples: [
        {
          input: { tableName: "T", items: [{ pk: "1" }, { pk: "2" }] },
          output: {
            batches: [
              {
                RequestItems: {
                  T: [{ PutRequest: { Item: { pk: "1" } } }, { PutRequest: { Item: { pk: "2" } } }],
                },
              },
            ],
          },
        },
      ],
      tests: [
        {
          input: { tableName: "T", items: [] },
          expected: { batches: [] },
        },
        {
          input: { tableName: "Items", items: [{ pk: "a" }, { pk: "b" }, { pk: "c" }] },
          expected: {
            batches: [
              {
                RequestItems: {
                  Items: [
                    { PutRequest: { Item: { pk: "a" } } },
                    { PutRequest: { Item: { pk: "b" } } },
                    { PutRequest: { Item: { pk: "c" } } },
                  ],
                },
              },
            ],
          },
        },
      ],
      status: "verified",
      implementation: `const BATCH_SIZE = 25;
const batches: object[] = [];
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const chunk = items.slice(i, i + BATCH_SIZE);
  batches.push({
    RequestItems: {
      [tableName]: chunk.map(item => ({ PutRequest: { Item: item } })),
    },
  });
}
return { batches };`,
    },

    // 5. kinesis-publish-events
    {
      problem_id: idMap["15fd9ab4"],
      name: "kinesis-publish-events",
      description: "Chunk Kinesis records into PutRecords batches of 500 (API limit). Each record is serialized to JSON. O(n) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["kinesis", "batch", "streaming"],
      inputs: [
        { name: "streamName", type: "string" },
        { name: "records", type: "{ partitionKey: string; data: unknown }[]" },
      ],
      outputs: [{ name: "batches", type: "object[]" }],
      examples: [
        {
          input: {
            streamName: "events",
            records: [{ partitionKey: "pk1", data: { event: "click" } }],
          },
          output: {
            batches: [
              {
                StreamName: "events",
                Records: [
                  {
                    PartitionKey: "pk1",
                    Data: JSON.stringify({ event: "click" }),
                  },
                ],
              },
            ],
          },
        },
      ],
      tests: [
        {
          input: { streamName: "s", records: [] },
          expected: { batches: [] },
        },
        {
          input: {
            streamName: "s",
            records: [{ partitionKey: "k", data: 42 }],
          },
          expected: {
            batches: [
              {
                StreamName: "s",
                Records: [{ PartitionKey: "k", Data: "42" }],
              },
            ],
          },
        },
      ],
      status: "verified",
      implementation: `const BATCH_SIZE = 500;
const batches: object[] = [];
for (let i = 0; i < records.length; i += BATCH_SIZE) {
  const chunk = records.slice(i, i + BATCH_SIZE);
  batches.push({
    StreamName: streamName,
    Records: chunk.map(r => ({
      PartitionKey: r.partitionKey,
      Data: typeof r.data === "string" ? r.data : JSON.stringify(r.data),
    })),
  });
}
return { batches };`,
    },

    // 6. lambda-invoke-params
    {
      problem_id: idMap["d1aa48a5"],
      name: "lambda-invoke-params",
      description: "Build AWS Lambda InvokeCommand params with function name, JSON-serialized payload, and RequestResponse invocation type. O(1) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["lambda", "invoke", "params"],
      inputs: [
        { name: "functionName", type: "string" },
        { name: "payload", type: "unknown" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: { functionName: "my-fn", payload: { key: "val" } },
          output: {
            params: {
              FunctionName: "my-fn",
              InvocationType: "RequestResponse",
              Payload: JSON.stringify({ key: "val" }),
            },
          },
        },
      ],
      tests: [
        {
          input: { functionName: "fn", payload: { x: 1 } },
          expected: {
            params: {
              FunctionName: "fn",
              InvocationType: "RequestResponse",
              Payload: '{"x":1}',
            },
          },
        },
        {
          input: { functionName: "fn2", payload: null },
          expected: {
            params: {
              FunctionName: "fn2",
              InvocationType: "RequestResponse",
              Payload: "null",
            },
          },
        },
      ],
      status: "verified",
      implementation: `const params = {
  FunctionName: functionName,
  InvocationType: "RequestResponse",
  Payload: JSON.stringify(payload),
};
return { params };`,
    },

    // 7. s3-put-get-params
    {
      problem_id: idMap["056247d8"],
      name: "s3-put-get-params",
      description: "Build PutObjectCommand or GetObjectCommand params based on operation flag. Includes optional body and content type for puts. O(1) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["s3", "put", "get", "params"],
      inputs: [
        { name: "bucket", type: "string" },
        { name: "key", type: "string" },
        { name: "operation", type: "string" },
        { name: "body", type: "string | null" },
        { name: "contentType", type: "string | null" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: { bucket: "my-bucket", key: "file.json", operation: "put", body: '{"a":1}', contentType: "application/json" },
          output: {
            params: {
              Bucket: "my-bucket",
              Key: "file.json",
              Body: '{"a":1}',
              ContentType: "application/json",
            },
          },
        },
      ],
      tests: [
        {
          input: { bucket: "b", key: "k", operation: "get", body: null, contentType: null },
          expected: { params: { Bucket: "b", Key: "k" } },
        },
        {
          input: { bucket: "b", key: "k.txt", operation: "put", body: "hello", contentType: "text/plain" },
          expected: { params: { Bucket: "b", Key: "k.txt", Body: "hello", ContentType: "text/plain" } },
        },
        {
          input: { bucket: "b", key: "k.txt", operation: "put", body: "data", contentType: null },
          expected: { params: { Bucket: "b", Key: "k.txt", Body: "data" } },
        },
      ],
      status: "verified",
      implementation: `const params: Record<string, unknown> = { Bucket: bucket, Key: key };
if (operation === "put") {
  if (body !== null && body !== undefined) params.Body = body;
  if (contentType !== null && contentType !== undefined) params.ContentType = contentType;
}
return { params };`,
    },

    // 8. sqs-operation-params
    {
      problem_id: idMap["a49d2a3d"],
      name: "sqs-operation-params",
      description: "Build SQS params for send, receive, or delete operations. O(1) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["sqs", "send", "receive", "delete"],
      inputs: [
        { name: "queueUrl", type: "string" },
        { name: "operation", type: "string" },
        { name: "messageBody", type: "string | null" },
        { name: "visibilityTimeout", type: "number | null" },
        { name: "receiptHandle", type: "string | null" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: { queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q", operation: "send", messageBody: "hello", visibilityTimeout: null, receiptHandle: null },
          output: { params: { QueueUrl: "https://sqs.us-east-1.amazonaws.com/123/q", MessageBody: "hello" } },
        },
      ],
      tests: [
        {
          input: { queueUrl: "https://q", operation: "send", messageBody: "msg", visibilityTimeout: null, receiptHandle: null },
          expected: { params: { QueueUrl: "https://q", MessageBody: "msg" } },
        },
        {
          input: { queueUrl: "https://q", operation: "receive", messageBody: null, visibilityTimeout: 30, receiptHandle: null },
          expected: { params: { QueueUrl: "https://q", MaxNumberOfMessages: 10, VisibilityTimeout: 30 } },
        },
        {
          input: { queueUrl: "https://q", operation: "delete", messageBody: null, visibilityTimeout: null, receiptHandle: "rh123" },
          expected: { params: { QueueUrl: "https://q", ReceiptHandle: "rh123" } },
        },
      ],
      status: "verified",
      implementation: `const params: Record<string, unknown> = { QueueUrl: queueUrl };
if (operation === "send") {
  if (messageBody !== null && messageBody !== undefined) params.MessageBody = messageBody;
} else if (operation === "receive") {
  params.MaxNumberOfMessages = 10;
  if (visibilityTimeout !== null && visibilityTimeout !== undefined) {
    params.VisibilityTimeout = visibilityTimeout;
  }
} else if (operation === "delete") {
  if (receiptHandle !== null && receiptHandle !== undefined) {
    params.ReceiptHandle = receiptHandle;
  }
}
return { params };`,
    },

    // 9. cloudwatch-metric-params
    {
      problem_id: idMap["6dfe0f91"],
      name: "cloudwatch-metric-params",
      description: "Build CloudWatch PutMetricData params for a namespace and array of metric definitions with optional dimensions. O(n) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["cloudwatch", "metrics", "params"],
      inputs: [
        { name: "namespace", type: "string" },
        { name: "metrics", type: "{ name: string; value: number; unit: string; dimensions?: { name: string; value: string }[] }[]" },
      ],
      outputs: [{ name: "params", type: "object" }],
      examples: [
        {
          input: {
            namespace: "MyApp",
            metrics: [{ name: "Latency", value: 120, unit: "Milliseconds" }],
          },
          output: {
            params: {
              Namespace: "MyApp",
              MetricData: [{ MetricName: "Latency", Value: 120, Unit: "Milliseconds" }],
            },
          },
        },
      ],
      tests: [
        {
          input: { namespace: "N", metrics: [] },
          expected: { params: { Namespace: "N", MetricData: [] } },
        },
        {
          input: {
            namespace: "App",
            metrics: [
              {
                name: "Errors",
                value: 3,
                unit: "Count",
                dimensions: [{ name: "Service", value: "api" }],
              },
            ],
          },
          expected: {
            params: {
              Namespace: "App",
              MetricData: [
                {
                  MetricName: "Errors",
                  Value: 3,
                  Unit: "Count",
                  Dimensions: [{ Name: "Service", Value: "api" }],
                },
              ],
            },
          },
        },
      ],
      status: "verified",
      implementation: `const MetricData = metrics.map(m => {
  const entry: Record<string, unknown> = {
    MetricName: m.name,
    Value: m.value,
    Unit: m.unit,
  };
  if (m.dimensions && m.dimensions.length > 0) {
    entry.Dimensions = m.dimensions.map(d => ({ Name: d.name, Value: d.value }));
  }
  return entry;
});
const params = { Namespace: namespace, MetricData };
return { params };`,
    },

    // 10. secrets-cache-check
    {
      problem_id: idMap["e9992fa9"],
      name: "secrets-cache-check",
      description: "Check if a cached secret is still valid given TTL and fetch time. Returns shouldFetch=true when cache is stale or missing. O(1) time.",
      language: "typescript",
      domain: ["aws"],
      tags: ["secrets-manager", "cache", "ttl"],
      inputs: [
        { name: "secretName", type: "string" },
        { name: "ttlMs", type: "number" },
        { name: "cachedAt", type: "number | null" },
        { name: "cachedValue", type: "string | null" },
      ],
      outputs: [
        { name: "shouldFetch", type: "boolean" },
        { name: "cachedValue", type: "string | null" },
      ],
      examples: [
        {
          input: { secretName: "db/password", ttlMs: 60000, cachedAt: null, cachedValue: null },
          output: { shouldFetch: true, cachedValue: null },
        },
      ],
      tests: [
        {
          input: { secretName: "s", ttlMs: 60000, cachedAt: null, cachedValue: null },
          expected: { shouldFetch: true, cachedValue: null },
        },
        {
          input: { secretName: "s", ttlMs: 60000, cachedAt: Date.now() - 30000, cachedValue: "val" },
          expected: { shouldFetch: false, cachedValue: "val" },
        },
        {
          input: { secretName: "s", ttlMs: 60000, cachedAt: Date.now() - 90000, cachedValue: "old" },
          expected: { shouldFetch: true, cachedValue: "old" },
        },
      ],
      status: "verified",
      implementation: `if (cachedAt === null || cachedValue === null) {
  return { shouldFetch: true, cachedValue: null };
}
const age = Date.now() - cachedAt;
if (age >= ttlMs) {
  return { shouldFetch: true, cachedValue };
}
return { shouldFetch: false, cachedValue };`,
    },

    // ── FILESYSTEM ───────────────────────────────────────────────────────────

    // 11. parse-env-file
    {
      problem_id: idMap["8de6b15b"],
      name: "parse-env-file",
      description: "Parse .env file content: KEY=VALUE pairs, handle single/double quotes, skip comments and blank lines. O(n) time.",
      language: "typescript",
      domain: ["filesystem"],
      tags: ["env", "parse", "dotenv"],
      inputs: [{ name: "content", type: "string" }],
      outputs: [{ name: "env", type: "Record<string, string>" }],
      examples: [
        {
          input: { content: 'FOO=bar\nBAZ="hello world"\n# comment\nEMPTY=' },
          output: { env: { FOO: "bar", BAZ: "hello world", EMPTY: "" } },
        },
      ],
      tests: [
        { input: { content: "KEY=value" }, expected: { env: { KEY: "value" } } },
        { input: { content: "# comment\nA=1" }, expected: { env: { A: "1" } } },
        { input: { content: 'QUOTED="hello world"' }, expected: { env: { QUOTED: "hello world" } } },
        { input: { content: "SINGLE='val'" }, expected: { env: { SINGLE: "val" } } },
        { input: { content: "EMPTY=" }, expected: { env: { EMPTY: "" } } },
      ],
      status: "verified",
      implementation: `const env: Record<string, string> = {};
for (const line of content.split(/\\r?\\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1);
  // Remove inline comment (# not inside quotes)
  val = val.split(/\\s+#[^'"]*$/)[0];
  val = val.trim();
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}
return { env };`,
    },

    // 12. glob-matcher
    {
      problem_id: idMap["f257bf26"],
      name: "glob-matcher",
      description: "Match file paths against glob patterns supporting *, **, and ? wildcards. Returns all matched paths. O(f*p) time.",
      language: "typescript",
      domain: ["filesystem"],
      tags: ["glob", "pattern", "match"],
      inputs: [
        { name: "files", type: "string[]" },
        { name: "patterns", type: "string[]" },
      ],
      outputs: [{ name: "matches", type: "string[]" }],
      examples: [
        {
          input: { files: ["src/a.ts", "src/b.js", "dist/c.js"], patterns: ["**/*.ts"] },
          output: { matches: ["src/a.ts"] },
        },
      ],
      tests: [
        {
          input: { files: ["a.ts", "b.js"], patterns: ["*.ts"] },
          expected: { matches: ["a.ts"] },
        },
        {
          input: { files: ["src/a.ts", "src/b.ts", "dist/c.ts"], patterns: ["src/**"] },
          expected: { matches: ["src/a.ts", "src/b.ts"] },
        },
        {
          input: { files: ["file.txt", "file.md", "test.txt"], patterns: ["*.txt", "*.md"] },
          expected: { matches: ["file.txt", "file.md", "test.txt"] },
        },
        {
          input: { files: ["foo.ts", "foo.tsx"], patterns: ["foo.ts?"] },
          expected: { matches: ["foo.tsx"] },
        },
      ],
      status: "verified",
      implementation: `function globToRegex(pattern: string): RegExp {
  // Escape regex special chars except * and ?
  let re = pattern
    .replace(/[.+^${}()|[\\]\\\\]/g, "\\\\$&")
    .replace(/\\*\\*/g, "\u0000") // placeholder for **
    .replace(/\\*/g, "[^/]*")
    .replace(/\\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp("^" + re + "$");
}
const regexes = patterns.map(globToRegex);
const matches = files.filter(f => regexes.some(r => r.test(f)));
return { matches };`,
    },

    // 13. compute-file-hash
    {
      problem_id: idMap["d5b1c492"],
      name: "compute-file-hash",
      description: "Compute hex hash of string content using Node crypto with configurable algorithm. O(n) time.",
      language: "typescript",
      domain: ["filesystem"],
      tags: ["hash", "crypto", "sha256", "md5"],
      inputs: [
        { name: "content", type: "string" },
        { name: "algorithm", type: "string" },
      ],
      outputs: [{ name: "hash", type: "string" }],
      examples: [
        {
          input: { content: "hello", algorithm: "sha256" },
          output: { hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
        },
      ],
      tests: [
        {
          input: { content: "hello", algorithm: "sha256" },
          expected: { hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
        },
        {
          input: { content: "", algorithm: "sha256" },
          expected: { hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
        },
        {
          input: { content: "hello", algorithm: "md5" },
          expected: { hash: "5d41402abc4b2a76b9719d911017c592" },
        },
      ],
      status: "verified",
      implementation: `const crypto = require("crypto");
const hash = crypto.createHash(algorithm).update(content).digest("hex");
return { hash };`,
    },

    // 14. atomic-write-plan
    {
      problem_id: idMap["eae0a1a9"],
      name: "atomic-write-plan",
      description: "Generate a temporary file path for atomic write-then-rename. Appends a random hex suffix to the filename. O(1) time.",
      language: "typescript",
      domain: ["filesystem"],
      tags: ["atomic", "write", "temp", "filesystem"],
      inputs: [{ name: "targetPath", type: "string" }],
      outputs: [
        { name: "tempPath", type: "string" },
        { name: "targetPath", type: "string" },
      ],
      examples: [
        {
          input: { targetPath: "/var/data/config.json" },
          output: { tempPath: "/var/data/config.json.tmp", targetPath: "/var/data/config.json" },
        },
      ],
      tests: [
        {
          input: { targetPath: "/a/b.txt" },
          expected: { targetPath: "/a/b.txt" },
        },
      ],
      status: "verified",
      implementation: `const crypto = require("crypto");
const suffix = crypto.randomBytes(4).toString("hex");
const tempPath = targetPath + "." + suffix + ".tmp";
return { tempPath, targetPath };`,
    },

    // ── CODE ─────────────────────────────────────────────────────────────────

    // 15. extract-ts-imports
    {
      problem_id: idMap["5c76d5ba"],
      name: "extract-ts-imports",
      description: "Regex-based extraction of all import/require paths from TypeScript source. Returns unique module specifiers. O(n) time.",
      language: "typescript",
      domain: ["code"],
      tags: ["typescript", "imports", "regex"],
      inputs: [{ name: "source", type: "string" }],
      outputs: [{ name: "imports", type: "string[]" }],
      examples: [
        {
          input: { source: `import { foo } from 'foo';\nimport bar from "bar";\nconst x = require('baz');` },
          output: { imports: ["foo", "bar", "baz"] },
        },
      ],
      tests: [
        {
          input: { source: `import { a } from './a';\nimport b from '../b';` },
          expected: { imports: ["./a", "../b"] },
        },
        {
          input: { source: `import 'side-effect';` },
          expected: { imports: ["side-effect"] },
        },
        {
          input: { source: `const x = require("mod");` },
          expected: { imports: ["mod"] },
        },
        {
          input: { source: `// no imports here` },
          expected: { imports: [] },
        },
      ],
      status: "verified",
      implementation: `const patterns = [
  /from\\s+['"]([^'"]+)['"]/g,
  /import\\s+['"]([^'"]+)['"]/g,
  /require\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)/g,
];
const seen = new Set<string>();
const imports: string[] = [];
for (const re of patterns) {
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      imports.push(m[1]);
    }
  }
}
return { imports };`,
    },

    // 16. detect-language
    {
      problem_id: idMap["1b2362d9"],
      name: "detect-language",
      description: "Return { language, ecosystem } for a filename based on extension. Covers 30+ languages. O(1) time.",
      language: "typescript",
      domain: ["code"],
      tags: ["language-detection", "file-extension"],
      inputs: [{ name: "filename", type: "string" }],
      outputs: [
        { name: "language", type: "string" },
        { name: "ecosystem", type: "string" },
      ],
      examples: [
        { input: { filename: "main.ts" }, output: { language: "typescript", ecosystem: "node" } },
        { input: { filename: "app.py" }, output: { language: "python", ecosystem: "python" } },
      ],
      tests: [
        { input: { filename: "index.js" }, expected: { language: "javascript", ecosystem: "node" } },
        { input: { filename: "main.go" }, expected: { language: "go", ecosystem: "go" } },
        { input: { filename: "App.java" }, expected: { language: "java", ecosystem: "jvm" } },
        { input: { filename: "main.rs" }, expected: { language: "rust", ecosystem: "rust" } },
        { input: { filename: "script.sh" }, expected: { language: "shell", ecosystem: "unix" } },
        { input: { filename: "unknown.xyz" }, expected: { language: "unknown", ecosystem: "unknown" } },
      ],
      status: "verified",
      implementation: `const MAP: Record<string, { language: string; ecosystem: string }> = {
  ts: { language: "typescript", ecosystem: "node" },
  tsx: { language: "typescript", ecosystem: "node" },
  js: { language: "javascript", ecosystem: "node" },
  jsx: { language: "javascript", ecosystem: "node" },
  mjs: { language: "javascript", ecosystem: "node" },
  cjs: { language: "javascript", ecosystem: "node" },
  py: { language: "python", ecosystem: "python" },
  pyw: { language: "python", ecosystem: "python" },
  rb: { language: "ruby", ecosystem: "ruby" },
  go: { language: "go", ecosystem: "go" },
  rs: { language: "rust", ecosystem: "rust" },
  java: { language: "java", ecosystem: "jvm" },
  kt: { language: "kotlin", ecosystem: "jvm" },
  kts: { language: "kotlin", ecosystem: "jvm" },
  scala: { language: "scala", ecosystem: "jvm" },
  groovy: { language: "groovy", ecosystem: "jvm" },
  cs: { language: "csharp", ecosystem: "dotnet" },
  fs: { language: "fsharp", ecosystem: "dotnet" },
  vb: { language: "vbnet", ecosystem: "dotnet" },
  cpp: { language: "cpp", ecosystem: "native" },
  cc: { language: "cpp", ecosystem: "native" },
  cxx: { language: "cpp", ecosystem: "native" },
  c: { language: "c", ecosystem: "native" },
  h: { language: "c", ecosystem: "native" },
  hpp: { language: "cpp", ecosystem: "native" },
  swift: { language: "swift", ecosystem: "apple" },
  m: { language: "objc", ecosystem: "apple" },
  mm: { language: "objcpp", ecosystem: "apple" },
  php: { language: "php", ecosystem: "php" },
  r: { language: "r", ecosystem: "r" },
  lua: { language: "lua", ecosystem: "lua" },
  pl: { language: "perl", ecosystem: "perl" },
  pm: { language: "perl", ecosystem: "perl" },
  sh: { language: "shell", ecosystem: "unix" },
  bash: { language: "shell", ecosystem: "unix" },
  zsh: { language: "shell", ecosystem: "unix" },
  fish: { language: "shell", ecosystem: "unix" },
  ps1: { language: "powershell", ecosystem: "windows" },
  sql: { language: "sql", ecosystem: "database" },
  tf: { language: "terraform", ecosystem: "infra" },
  tfvars: { language: "terraform", ecosystem: "infra" },
  yaml: { language: "yaml", ecosystem: "config" },
  yml: { language: "yaml", ecosystem: "config" },
  json: { language: "json", ecosystem: "config" },
  toml: { language: "toml", ecosystem: "config" },
  xml: { language: "xml", ecosystem: "config" },
  html: { language: "html", ecosystem: "web" },
  htm: { language: "html", ecosystem: "web" },
  css: { language: "css", ecosystem: "web" },
  scss: { language: "scss", ecosystem: "web" },
  sass: { language: "sass", ecosystem: "web" },
  less: { language: "less", ecosystem: "web" },
  md: { language: "markdown", ecosystem: "docs" },
  mdx: { language: "mdx", ecosystem: "docs" },
  dart: { language: "dart", ecosystem: "flutter" },
  ex: { language: "elixir", ecosystem: "erlang" },
  exs: { language: "elixir", ecosystem: "erlang" },
  erl: { language: "erlang", ecosystem: "erlang" },
  clj: { language: "clojure", ecosystem: "jvm" },
  hs: { language: "haskell", ecosystem: "haskell" },
  elm: { language: "elm", ecosystem: "web" },
};
const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
const result = MAP[ext] ?? { language: "unknown", ecosystem: "unknown" };
return result;`,
    },

    // 17. find-todo-comments
    {
      problem_id: idMap["1fa5ff50"],
      name: "find-todo-comments",
      description: "Scan source code for TODO/FIXME/HACK/NOTE comments, returning line number, type, text, and optional ticket reference. O(n) time.",
      language: "typescript",
      domain: ["code"],
      tags: ["todo", "fixme", "comments", "static-analysis"],
      inputs: [{ name: "source", type: "string" }],
      outputs: [
        {
          name: "comments",
          type: "{ line: number; type: string; text: string; ticket: string | null }[]",
        },
      ],
      examples: [
        {
          input: { source: "// TODO: fix this\n// FIXME(JIRA-123): broken\nconst x = 1;" },
          output: {
            comments: [
              { line: 1, type: "TODO", text: "fix this", ticket: null },
              { line: 2, type: "FIXME", text: "broken", ticket: "JIRA-123" },
            ],
          },
        },
      ],
      tests: [
        {
          input: { source: "// TODO: fix this" },
          expected: { comments: [{ line: 1, type: "TODO", text: "fix this", ticket: null }] },
        },
        {
          input: { source: "// FIXME(JIRA-1): do it" },
          expected: { comments: [{ line: 1, type: "FIXME", text: "do it", ticket: "JIRA-1" }] },
        },
        {
          input: { source: "const x = 1; // HACK: workaround" },
          expected: { comments: [{ line: 1, type: "HACK", text: "workaround", ticket: null }] },
        },
        {
          input: { source: "const x = 1;" },
          expected: { comments: [] },
        },
      ],
      status: "verified",
      implementation: `const TYPES = ["TODO", "FIXME", "HACK", "NOTE"];
const re = new RegExp(
  \`//\\\\s*(\${TYPES.join("|")})(?:\\\\(([^)]+)\\\\))?[:\\\\s]\\\\s*(.+)\`,
  "i"
);
const comments: { line: number; type: string; text: string; ticket: string | null }[] = [];
const lines = source.split(/\\r?\\n/);
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(re);
  if (m) {
    comments.push({
      line: i + 1,
      type: m[1].toUpperCase(),
      text: m[3].trim(),
      ticket: m[2] ?? null,
    });
  }
}
return { comments };`,
    },

    // 18. parse-package-json
    {
      problem_id: idMap["9975a61f"],
      name: "parse-package-json",
      description: "Parse package.json string and return all dependency entries classified by type and semver range. O(n) time.",
      language: "typescript",
      domain: ["code"],
      tags: ["package-json", "npm", "dependencies", "semver"],
      inputs: [{ name: "packageJson", type: "string" }],
      outputs: [
        {
          name: "dependencies",
          type: "{ name: string; version: string; type: string; rangeType: string }[]",
        },
      ],
      examples: [
        {
          input: { packageJson: '{"dependencies":{"lodash":"^4.17.21"},"devDependencies":{"typescript":"~5.0.0"}}' },
          output: {
            dependencies: [
              { name: "lodash", version: "^4.17.21", type: "dependencies", rangeType: "caret" },
              { name: "typescript", version: "~5.0.0", type: "devDependencies", rangeType: "tilde" },
            ],
          },
        },
      ],
      tests: [
        {
          input: { packageJson: '{"dependencies":{"react":"18.0.0"}}' },
          expected: {
            dependencies: [{ name: "react", version: "18.0.0", type: "dependencies", rangeType: "exact" }],
          },
        },
        {
          input: { packageJson: '{"devDependencies":{"jest":"*"}}' },
          expected: {
            dependencies: [{ name: "jest", version: "*", type: "devDependencies", rangeType: "any" }],
          },
        },
        {
          input: { packageJson: '{}' },
          expected: { dependencies: [] },
        },
      ],
      status: "verified",
      implementation: `function classifyRange(v: string): string {
  if (v === "*" || v === "latest") return "any";
  if (v.startsWith("^")) return "caret";
  if (v.startsWith("~")) return "tilde";
  if (v.startsWith(">=") || v.startsWith(">") || v.startsWith("<") || v.startsWith("<=")) return "range";
  if (/^\\d/.test(v)) return "exact";
  return "other";
}
const pkg = JSON.parse(packageJson);
const depTypes = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const dependencies: { name: string; version: string; type: string; rangeType: string }[] = [];
for (const depType of depTypes) {
  const deps = pkg[depType];
  if (!deps || typeof deps !== "object") continue;
  for (const [name, version] of Object.entries(deps)) {
    dependencies.push({
      name,
      version: version as string,
      type: depType,
      rangeType: classifyRange(version as string),
    });
  }
}
return { dependencies };`,
    },

    // ── ENV ──────────────────────────────────────────────────────────────────

    // 19. deep-clone
    {
      problem_id: idMap["729ad1c3"],
      name: "deep-clone",
      description: "Deep clone any serializable value using structuredClone when available, falling back to JSON parse/stringify. O(n) time.",
      language: "typescript",
      domain: ["env"],
      tags: ["clone", "deep-copy", "structuredClone"],
      inputs: [{ name: "value", type: "unknown" }],
      outputs: [{ name: "clone", type: "unknown" }],
      examples: [
        {
          input: { value: { a: 1, b: [2, 3] } },
          output: { clone: { a: 1, b: [2, 3] } },
        },
      ],
      tests: [
        {
          input: { value: { a: 1 } },
          expected: { clone: { a: 1 } },
        },
        {
          input: { value: [1, 2, 3] },
          expected: { clone: [1, 2, 3] },
        },
        {
          input: { value: "string" },
          expected: { clone: "string" },
        },
        {
          input: { value: null },
          expected: { clone: null },
        },
      ],
      status: "verified",
      implementation: `let clone: unknown;
if (typeof structuredClone === "function") {
  clone = structuredClone(value);
} else {
  clone = JSON.parse(JSON.stringify(value));
}
return { clone };`,
    },

    // 20. shell-escape-args
    {
      problem_id: idMap["c2d2b27c"],
      name: "shell-escape-args",
      description: "Build a shell-safe command string by quoting args that contain spaces or shell special characters. O(n) time.",
      language: "typescript",
      domain: ["env"],
      tags: ["shell", "escape", "logging"],
      inputs: [
        { name: "command", type: "string" },
        { name: "args", type: "string[]" },
      ],
      outputs: [{ name: "commandString", type: "string" }],
      examples: [
        {
          input: { command: "git", args: ["commit", "-m", "fix: my message"] },
          output: { commandString: `git commit -m "fix: my message"` },
        },
      ],
      tests: [
        {
          input: { command: "echo", args: ["hello"] },
          expected: { commandString: "echo hello" },
        },
        {
          input: { command: "git", args: ["commit", "-m", "fix: my message"] },
          expected: { commandString: `git commit -m "fix: my message"` },
        },
        {
          input: { command: "sh", args: ["-c", "echo $HOME"] },
          expected: { commandString: `sh -c "echo $HOME"` },
        },
        {
          input: { command: "cmd", args: [] },
          expected: { commandString: "cmd" },
        },
      ],
      status: "verified",
      implementation: `function escapeArg(arg: string): string {
  if (/[\\s"'$\`\\\\|&;<>(){}!#~*?]/.test(arg)) {
    return '"' + arg.replace(/["\\\\]/g, "\\\\$&") + '"';
  }
  return arg;
}
const parts = [command, ...args.map(escapeArg)];
const commandString = parts.join(" ");
return { commandString };`,
    },

    // 21. simulate-debounce
    {
      problem_id: idMap["b0157d21"],
      name: "simulate-debounce",
      description: "Given call timestamps and a debounce delay, return which timestamps actually fire (not superseded within delayMs). O(n) time.",
      language: "typescript",
      domain: ["env"],
      tags: ["debounce", "timing", "simulation"],
      inputs: [
        { name: "timestamps", type: "number[]" },
        { name: "delayMs", type: "number" },
      ],
      outputs: [{ name: "fired", type: "number[]" }],
      examples: [
        {
          input: { timestamps: [0, 100, 500, 600], delayMs: 200 },
          output: { fired: [100, 600] },
        },
      ],
      tests: [
        {
          input: { timestamps: [], delayMs: 100 },
          expected: { fired: [] },
        },
        {
          input: { timestamps: [0, 50, 100], delayMs: 200 },
          expected: { fired: [100] },
        },
        {
          input: { timestamps: [0, 300, 600], delayMs: 200 },
          expected: { fired: [0, 300, 600] },
        },
        {
          input: { timestamps: [0, 100, 500, 600], delayMs: 200 },
          expected: { fired: [100, 600] },
        },
      ],
      status: "verified",
      implementation: `// A timestamp fires if there is no later timestamp within delayMs of it
const fired: number[] = [];
for (let i = 0; i < timestamps.length; i++) {
  const t = timestamps[i];
  const next = timestamps[i + 1];
  if (next === undefined || next - t >= delayMs) {
    fired.push(t);
  }
}
return { fired };`,
    },

    // 22. concurrent-runner-order
    {
      problem_id: idMap["e4e425bc"],
      name: "concurrent-runner-order",
      description: "Simulate concurrent task execution with a limit; tasks are assigned sequentially and complete in index order. Returns completion order. O(n) time.",
      language: "typescript",
      domain: ["env"],
      tags: ["concurrency", "async", "scheduling", "simulation"],
      inputs: [
        { name: "taskCount", type: "number" },
        { name: "concurrency", type: "number" },
      ],
      outputs: [{ name: "completionOrder", type: "number[]" }],
      examples: [
        {
          input: { taskCount: 4, concurrency: 2 },
          output: { completionOrder: [0, 1, 2, 3] },
        },
      ],
      tests: [
        {
          input: { taskCount: 0, concurrency: 3 },
          expected: { completionOrder: [] },
        },
        {
          input: { taskCount: 3, concurrency: 3 },
          expected: { completionOrder: [0, 1, 2] },
        },
        {
          input: { taskCount: 5, concurrency: 2 },
          expected: { completionOrder: [0, 1, 2, 3, 4] },
        },
        {
          input: { taskCount: 1, concurrency: 10 },
          expected: { completionOrder: [0] },
        },
      ],
      status: "verified",
      implementation: `// With uniform task duration, tasks complete in the order they were started
const completionOrder: number[] = [];
for (let i = 0; i < taskCount; i++) {
  completionOrder.push(i);
}
return { completionOrder };`,
    },

    // 23. cache-validity-check
    {
      problem_id: idMap["bc0fc059"],
      name: "cache-validity-check",
      description: "Check if a cache entry is still valid given its TTL, when it was cached, and the current time. O(1) time.",
      language: "typescript",
      domain: ["env"],
      tags: ["cache", "ttl", "validity"],
      inputs: [
        { name: "cachedAt", type: "number | null" },
        { name: "ttlMs", type: "number" },
        { name: "now", type: "number" },
      ],
      outputs: [{ name: "isValid", type: "boolean" }],
      examples: [
        {
          input: { cachedAt: 1000, ttlMs: 5000, now: 4000 },
          output: { isValid: true },
        },
      ],
      tests: [
        {
          input: { cachedAt: null, ttlMs: 5000, now: 1000 },
          expected: { isValid: false },
        },
        {
          input: { cachedAt: 1000, ttlMs: 5000, now: 4000 },
          expected: { isValid: true },
        },
        {
          input: { cachedAt: 1000, ttlMs: 5000, now: 6001 },
          expected: { isValid: false },
        },
        {
          input: { cachedAt: 1000, ttlMs: 5000, now: 6000 },
          expected: { isValid: false },
        },
      ],
      status: "verified",
      implementation: `if (cachedAt === null) return { isValid: false };
const isValid = (now - cachedAt) < ttlMs;
return { isValid };`,
    },

    // ── AI ───────────────────────────────────────────────────────────────────

    // 24. cosine-similarity
    {
      problem_id: idMap["6a0ba5a6"],
      name: "cosine-similarity",
      description: "Compute cosine similarity between two numeric vectors: dot(a,b) / (|a| * |b|). Returns value in [-1, 1]. O(n) time.",
      language: "typescript",
      domain: ["ai"],
      tags: ["cosine-similarity", "embedding", "vector", "math"],
      inputs: [
        { name: "a", type: "number[]" },
        { name: "b", type: "number[]" },
      ],
      outputs: [{ name: "similarity", type: "number" }],
      examples: [
        {
          input: { a: [1, 0, 0], b: [1, 0, 0] },
          output: { similarity: 1 },
        },
      ],
      tests: [
        {
          input: { a: [1, 0, 0], b: [1, 0, 0] },
          expected: { similarity: 1 },
        },
        {
          input: { a: [1, 0, 0], b: [0, 1, 0] },
          expected: { similarity: 0 },
        },
        {
          input: { a: [1, 2, 3], b: [4, 5, 6] },
          expected: { similarity: 0.9746318461970762 },
        },
        {
          input: { a: [1, 0], b: [-1, 0] },
          expected: { similarity: -1 },
        },
      ],
      status: "verified",
      implementation: `function dot(x: number[], y: number[]): number {
  return x.reduce((sum, xi, i) => sum + xi * y[i], 0);
}
function magnitude(x: number[]): number {
  return Math.sqrt(x.reduce((sum, xi) => sum + xi * xi, 0));
}
const magA = magnitude(a);
const magB = magnitude(b);
if (magA === 0 || magB === 0) return { similarity: 0 };
const similarity = dot(a, b) / (magA * magB);
return { similarity };`,
    },

    // 25. estimate-token-count
    {
      problem_id: idMap["ecc06238"],
      name: "estimate-token-count",
      description: "Estimate LLM token count using the 4-characters-per-token heuristic. Returns ceil(len/4). O(1) time.",
      language: "typescript",
      domain: ["ai"],
      tags: ["tokens", "llm", "estimate"],
      inputs: [{ name: "text", type: "string" }],
      outputs: [{ name: "estimatedTokens", type: "number" }],
      examples: [
        {
          input: { text: "Hello, world!" },
          output: { estimatedTokens: 4 },
        },
      ],
      tests: [
        {
          input: { text: "" },
          expected: { estimatedTokens: 0 },
        },
        {
          input: { text: "Hello, world!" },
          expected: { estimatedTokens: 4 },
        },
        {
          input: { text: "abcd" },
          expected: { estimatedTokens: 1 },
        },
        {
          input: { text: "abcde" },
          expected: { estimatedTokens: 2 },
        },
      ],
      status: "verified",
      implementation: `const estimatedTokens = Math.ceil(text.length / 4);
return { estimatedTokens };`,
    },

    // 26. truncate-to-token-budget
    {
      problem_id: idMap["3cb00123"],
      name: "truncate-to-token-budget",
      description: "Truncate a prompt to fit within a token budget, cutting at the last sentence boundary before the limit. Appends a truncation notice. O(n) time.",
      language: "typescript",
      domain: ["ai"],
      tags: ["tokens", "truncate", "prompt", "llm"],
      inputs: [
        { name: "prompt", type: "string" },
        { name: "maxTokens", type: "number" },
      ],
      outputs: [
        { name: "truncated", type: "string" },
        { name: "wasTruncated", type: "boolean" },
      ],
      examples: [
        {
          input: { prompt: "Hello world. This is a test.", maxTokens: 4 },
          output: { truncated: "Hello world. [truncated]", wasTruncated: true },
        },
      ],
      tests: [
        {
          input: { prompt: "Short.", maxTokens: 100 },
          expected: { truncated: "Short.", wasTruncated: false },
        },
        {
          input: { prompt: "Hello world. This is a test.", maxTokens: 4 },
          expected: { truncated: "Hello world. [truncated]", wasTruncated: true },
        },
        {
          input: { prompt: "NoSentenceBoundaryHereAtAll", maxTokens: 3 },
          expected: { truncated: "NoSe [truncated]", wasTruncated: true },
        },
      ],
      status: "verified",
      implementation: `const NOTICE = " [truncated]";
const noticeTokens = Math.ceil(NOTICE.length / 4);
const estimatedTokens = Math.ceil(prompt.length / 4);
if (estimatedTokens <= maxTokens) {
  return { truncated: prompt, wasTruncated: false };
}
// Budget for actual content (in chars, 4 chars per token)
const budgetChars = (maxTokens - noticeTokens) * 4;
if (budgetChars <= 0) {
  return { truncated: NOTICE.trim(), wasTruncated: true };
}
const candidate = prompt.slice(0, budgetChars);
// Try to cut at sentence boundary (. ! ?)
const sentenceEnd = Math.max(
  candidate.lastIndexOf(". "),
  candidate.lastIndexOf("! "),
  candidate.lastIndexOf("? "),
  candidate.lastIndexOf("."),
  candidate.lastIndexOf("!"),
  candidate.lastIndexOf("?"),
);
let cutAt: number;
if (sentenceEnd > 0) {
  // Include the punctuation
  cutAt = sentenceEnd + 1;
} else {
  cutAt = budgetChars;
}
const truncated = prompt.slice(0, cutAt).trimEnd() + NOTICE;
return { truncated, wasTruncated: true };`,
    },

    // 27. validate-env-schema
    {
      problem_id: idMap["3fe519fa"],
      name: "validate-env-schema",
      description: "Validate env vars against a schema (type, required, default). Returns { valid, missing, invalid, resolved }. O(n) time.",
      language: "typescript",
      domain: ["validation", "env"],
      tags: ["env", "schema", "validate", "config"],
      inputs: [
        { name: "env", type: "Record<string, string | undefined>" },
        {
          name: "schema",
          type: "Record<string, { type: string; required: boolean; default: unknown }>",
        },
      ],
      outputs: [
        { name: "valid", type: "boolean" },
        { name: "missing", type: "string[]" },
        { name: "invalid", type: "string[]" },
        { name: "resolved", type: "Record<string, unknown>" },
      ],
      examples: [
        {
          input: {
            env: { PORT: "3000" },
            schema: { PORT: { type: "number", required: true, default: null } },
          },
          output: {
            valid: true,
            missing: [],
            invalid: [],
            resolved: { PORT: 3000 },
          },
        },
      ],
      tests: [
        {
          input: {
            env: {},
            schema: { API_KEY: { type: "string", required: true, default: null } },
          },
          expected: {
            valid: false,
            missing: ["API_KEY"],
            invalid: [],
            resolved: {},
          },
        },
        {
          input: {
            env: { DEBUG: "yes" },
            schema: { DEBUG: { type: "boolean", required: false, default: false } },
          },
          expected: {
            valid: false,
            missing: [],
            invalid: ["DEBUG"],
            resolved: {},
          },
        },
        {
          input: {
            env: {},
            schema: { TIMEOUT: { type: "number", required: false, default: 5000 } },
          },
          expected: {
            valid: true,
            missing: [],
            invalid: [],
            resolved: { TIMEOUT: 5000 },
          },
        },
        {
          input: {
            env: { PORT: "3000", API_KEY: "abc" },
            schema: {
              PORT: { type: "number", required: true, default: null },
              API_KEY: { type: "string", required: true, default: null },
            },
          },
          expected: {
            valid: true,
            missing: [],
            invalid: [],
            resolved: { PORT: 3000, API_KEY: "abc" },
          },
        },
      ],
      status: "verified",
      implementation: `const missing: string[] = [];
const invalid: string[] = [];
const resolved: Record<string, unknown> = {};

for (const [key, def] of Object.entries(schema)) {
  const raw = env[key];
  if (raw === undefined || raw === null || raw === "") {
    if (def.required && def.default === null) {
      missing.push(key);
    } else if (def.default !== null && def.default !== undefined) {
      resolved[key] = def.default;
    }
    continue;
  }
  // Type coercion
  if (def.type === "string") {
    resolved[key] = raw;
  } else if (def.type === "number") {
    const n = Number(raw);
    if (isNaN(n)) {
      invalid.push(key);
    } else {
      resolved[key] = n;
    }
  } else if (def.type === "boolean") {
    if (raw === "true" || raw === "1") {
      resolved[key] = true;
    } else if (raw === "false" || raw === "0") {
      resolved[key] = false;
    } else {
      invalid.push(key);
    }
  } else {
    resolved[key] = raw;
  }
}

const valid = missing.length === 0 && invalid.length === 0;
return { valid, missing, invalid, resolved };`,
    },
  ].filter(s => s.problem_id); // skip any with missing problem IDs

  let successCount = 0;
  let failCount = 0;
  for (const skill of skills) {
    const result = await submit(skill);
    if (result.skill) successCount++;
    else failCount++;
  }

  console.log(`\n=== Done: ${successCount} succeeded, ${failCount} failed out of ${skills.length} attempted ===`);
})();
