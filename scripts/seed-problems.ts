/**
 * Seed script: writes ~100 practical problems to codevolve-problems.
 *
 * These are real tasks that AI agents commonly need — string processing,
 * JSON transformation, HTTP utilities, datetime handling, encoding,
 * validation, array operations, AWS SDK patterns, code/file inspection,
 * and environment/config parsing.
 *
 * Run:
 *   npx ts-node --esm scripts/seed-problems.ts
 *   # or
 *   npx tsx scripts/seed-problems.ts
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-2" });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE = process.env.PROBLEMS_TABLE ?? "codevolve-problems";

interface ProblemSeed {
  name: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  domain: string[];
  tags: string[];
  constraints?: string;
}

const PROBLEMS: ProblemSeed[] = [
  // ── String ────────────────────────────────────────────────────────────────
  {
    name: "Truncate string with ellipsis",
    description:
      "Given a string and a max length, return the string truncated to that length with '...' appended if it was longer. The ellipsis counts toward the max length.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["truncate", "ellipsis", "text"],
    constraints: "maxLength >= 3",
  },
  {
    name: "camelCase to snake_case",
    description:
      "Convert a camelCase or PascalCase identifier to snake_case. Handles consecutive capitals (e.g. 'XMLParser' → 'xml_parser') and numeric boundaries.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["case-conversion", "naming", "identifier"],
  },
  {
    name: "snake_case to camelCase",
    description:
      "Convert a snake_case or kebab-case identifier to camelCase. Optionally return PascalCase when a flag is set.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["case-conversion", "naming", "identifier"],
  },
  {
    name: "Slugify string for URL",
    description:
      "Convert an arbitrary string into a URL-safe slug: lowercase, replace spaces and special characters with hyphens, collapse multiple hyphens, strip leading/trailing hyphens.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["slug", "url", "sanitize"],
  },
  {
    name: "Extract all URLs from text",
    description:
      "Given a block of text, return all HTTP/HTTPS URLs found in it. Each URL should be returned once even if it appears multiple times.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["url", "extract", "regex"],
  },
  {
    name: "Redact email addresses in text",
    description:
      "Replace all email addresses in a string with '[REDACTED]'. Preserve surrounding whitespace and punctuation.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["redact", "email", "privacy", "regex"],
  },
  {
    name: "Strip HTML tags",
    description:
      "Remove all HTML tags from a string, returning plain text. Preserve text content between tags. Handle self-closing tags and attribute values that contain angle brackets.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["html", "sanitize", "parse"],
  },
  {
    name: "Word frequency map",
    description:
      "Given a string, return a map of each word to its occurrence count. Case-insensitive. Ignore punctuation. Sort by count descending, then alphabetically.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["frequency", "word-count", "map"],
  },
  {
    name: "Wrap text at column width",
    description:
      "Wrap a string so no line exceeds the given column width. Break at word boundaries where possible; break within a word only if the word is longer than the width.",
    difficulty: "medium",
    domain: ["string"],
    tags: ["word-wrap", "formatting", "text"],
    constraints: "columnWidth >= 1",
  },
  {
    name: "Levenshtein distance",
    description:
      "Compute the edit distance (insertions, deletions, substitutions) between two strings. Used for fuzzy matching and typo detection.",
    difficulty: "medium",
    domain: ["string"],
    tags: ["edit-distance", "fuzzy", "similarity"],
  },
  {
    name: "Template string interpolation",
    description:
      "Given a template string with {{variable}} placeholders and a data object, return the string with each placeholder replaced by the corresponding value. Missing keys should be left as-is or replaced with a default.",
    difficulty: "easy",
    domain: ["string"],
    tags: ["template", "interpolation", "placeholder"],
  },
  {
    name: "Parse key=value string",
    description:
      "Parse a string of key=value pairs (optionally quoted values, shell-style) into an object. Handle spaces around =, quoted strings with escape sequences, and comment lines starting with #.",
    difficulty: "medium",
    domain: ["string", "env"],
    tags: ["parse", "key-value", "env", "dotenv"],
  },

  // ── JSON ──────────────────────────────────────────────────────────────────
  {
    name: "Flatten nested object",
    description:
      "Given a deeply nested object, return a flat object where nested keys are joined with a delimiter (default: '.'). Arrays are left as-is by default but can optionally be flattened with index notation.",
    difficulty: "medium",
    domain: ["json"],
    tags: ["flatten", "transform", "object"],
  },
  {
    name: "Deep merge objects",
    description:
      "Recursively merge two or more objects. Later sources override earlier ones for scalar values; arrays at the same path are replaced (not concatenated) unless a merge strategy is specified.",
    difficulty: "medium",
    domain: ["json"],
    tags: ["merge", "deep-merge", "object"],
  },
  {
    name: "Pick keys from object",
    description:
      "Return a new object containing only the specified keys from the source object. Keys that don't exist in the source are omitted from the result.",
    difficulty: "easy",
    domain: ["json"],
    tags: ["pick", "select", "object", "projection"],
  },
  {
    name: "Omit keys from object",
    description:
      "Return a new object with the specified keys removed. Deeply nested keys can be specified with dot notation.",
    difficulty: "easy",
    domain: ["json"],
    tags: ["omit", "exclude", "object"],
  },
  {
    name: "Deterministic JSON stringify",
    description:
      "Serialize an object to JSON with keys sorted alphabetically at every level of nesting. Produces the same output for the same data regardless of insertion order.",
    difficulty: "easy",
    domain: ["json"],
    tags: ["stringify", "deterministic", "canonical", "hash"],
  },
  {
    name: "Deep get value by dot-path",
    description:
      "Given an object and a dot-notation path string (e.g. 'a.b.c'), return the value at that path. Return a default if the path does not exist. Supports array index notation (e.g. 'items.0.name').",
    difficulty: "easy",
    domain: ["json"],
    tags: ["get", "path", "accessor", "lodash-like"],
  },
  {
    name: "Deep set value by dot-path",
    description:
      "Given an object and a dot-notation path string, set the value at that path, creating intermediate objects/arrays as needed. Return the mutated (or new) object.",
    difficulty: "easy",
    domain: ["json"],
    tags: ["set", "path", "mutate", "lodash-like"],
  },
  {
    name: "Diff two JSON objects",
    description:
      "Given two objects A and B, return a diff describing added keys, removed keys, and changed values. Recurse into nested objects. Output format: { added, removed, changed } with paths.",
    difficulty: "medium",
    domain: ["json"],
    tags: ["diff", "compare", "change-detection"],
  },
  {
    name: "Extract all values for a key",
    description:
      "Recursively walk an arbitrarily nested object/array structure and collect every value whose key matches a given name. Return an array of all found values.",
    difficulty: "medium",
    domain: ["json"],
    tags: ["extract", "recursive", "deep-search"],
  },
  {
    name: "Transform array of objects to keyed map",
    description:
      "Given an array of objects and a key field name, return an object keyed by the value of that field. Handles duplicate keys with a configurable strategy (last-wins, first-wins, array-collect).",
    difficulty: "easy",
    domain: ["json"],
    tags: ["index", "key-by", "map", "transform"],
  },

  // ── HTTP ──────────────────────────────────────────────────────────────────
  {
    name: "Retry with exponential backoff",
    description:
      "Wrap an async function with retry logic: exponential backoff with jitter, configurable max attempts, and a predicate to decide which errors are retryable.",
    difficulty: "medium",
    domain: ["http"],
    tags: ["retry", "backoff", "resilience", "async"],
  },
  {
    name: "Parse URL into components",
    description:
      "Given a URL string, return an object with protocol, host, port, pathname, search params (as a map), and hash. Handle relative URLs by resolving against an optional base.",
    difficulty: "easy",
    domain: ["http"],
    tags: ["url", "parse", "components"],
  },
  {
    name: "Build URL from base and params",
    description:
      "Given a base URL and an object of query parameters, return the full URL with parameters appended and properly encoded. Undefined/null values are omitted.",
    difficulty: "easy",
    domain: ["http"],
    tags: ["url", "build", "query-string", "encode"],
  },
  {
    name: "Extract bearer token from Authorization header",
    description:
      "Given an Authorization header value, extract the bearer token if present. Return null if the scheme is not 'Bearer' or the header is malformed.",
    difficulty: "easy",
    domain: ["http", "auth"],
    tags: ["bearer", "token", "authorization", "header"],
  },
  {
    name: "Paginate through API with cursor",
    description:
      "Given a fetch function that accepts a cursor and returns { items, next_cursor }, iterate pages until next_cursor is null/undefined. Return all collected items.",
    difficulty: "medium",
    domain: ["http"],
    tags: ["pagination", "cursor", "collect", "async"],
  },
  {
    name: "Parse multipart/form-data body",
    description:
      "Parse a multipart/form-data request body (given as a Buffer and boundary string) into an array of parts, each with headers and body.",
    difficulty: "hard",
    domain: ["http"],
    tags: ["multipart", "form-data", "parse"],
  },
  {
    name: "HTTP response to normalized error",
    description:
      "Given an HTTP Response object, detect non-2xx status codes and return a normalized Error with status, code, and message extracted from common error response shapes (JSON { error, message }, { code, detail }, etc.).",
    difficulty: "medium",
    domain: ["http"],
    tags: ["error-handling", "response", "normalize"],
  },

  // ── Datetime ──────────────────────────────────────────────────────────────
  {
    name: "Format duration as human-readable string",
    description:
      "Given a duration in milliseconds, return a human-readable string like '2h 34m 5s' or '450ms'. Omit zero-value units. Support compact and verbose modes.",
    difficulty: "easy",
    domain: ["datetime"],
    tags: ["duration", "format", "human-readable"],
  },
  {
    name: "Parse relative time expression",
    description:
      "Parse strings like '2 hours ago', 'in 3 days', 'yesterday', 'last week' and return an absolute Date. Return null if the expression is not recognized.",
    difficulty: "medium",
    domain: ["datetime"],
    tags: ["relative-time", "parse", "natural-language"],
  },
  {
    name: "Get start and end of a time period",
    description:
      "Given a Date and a period ('day' | 'week' | 'month' | 'quarter' | 'year'), return { start, end } as Date objects representing the boundaries of that period in the given or local timezone.",
    difficulty: "easy",
    domain: ["datetime"],
    tags: ["period", "start", "end", "boundary"],
  },
  {
    name: "Calculate business days between dates",
    description:
      "Count the number of business days (Mon–Fri, excluding provided holidays) between two dates. The start date is inclusive, the end date is exclusive.",
    difficulty: "medium",
    domain: ["datetime"],
    tags: ["business-days", "weekdays", "holidays"],
  },
  {
    name: "Convert date between timezones",
    description:
      "Given a Date object and a target IANA timezone string (e.g. 'America/New_York'), return the date components (year, month, day, hour, minute, second) as they would appear in that timezone.",
    difficulty: "medium",
    domain: ["datetime"],
    tags: ["timezone", "convert", "IANA"],
  },
  {
    name: "Parse ISO8601 duration string",
    description:
      "Parse an ISO8601 duration string (e.g. 'P1Y2M3DT4H5M6S') into its component parts and also return the total duration in milliseconds (approximating months as 30 days).",
    difficulty: "medium",
    domain: ["datetime"],
    tags: ["ISO8601", "duration", "parse"],
  },

  // ── Encoding / Hashing ────────────────────────────────────────────────────
  {
    name: "Base64 encode and decode",
    description:
      "Encode a string or Buffer to base64, and decode a base64 string back to a Buffer. Support both standard and URL-safe base64 variants. Handle padding correctly.",
    difficulty: "easy",
    domain: ["encoding"],
    tags: ["base64", "encode", "decode"],
  },
  {
    name: "SHA-256 hash with optional HMAC",
    description:
      "Hash a string or Buffer with SHA-256. When a secret key is provided, compute HMAC-SHA256 instead. Return the result as hex, base64, or a Buffer.",
    difficulty: "easy",
    domain: ["encoding"],
    tags: ["sha256", "hmac", "hash", "crypto"],
  },
  {
    name: "Generate deterministic UUID from input",
    description:
      "Given an arbitrary string, generate a UUID v5 (SHA-1 namespace hash) that is deterministic — the same input always produces the same UUID. Accept a namespace UUID or use a default.",
    difficulty: "easy",
    domain: ["encoding"],
    tags: ["uuid", "v5", "deterministic", "namespace"],
  },
  {
    name: "Compute content hash for cache key",
    description:
      "Given an arbitrary JSON-serializable value, produce a stable short hash (e.g. 8-char hex) suitable for use as a cache key. The hash must be identical for deeply equal values regardless of key order.",
    difficulty: "easy",
    domain: ["encoding"],
    tags: ["cache-key", "hash", "content-addressable"],
  },
  {
    name: "Encode/decode URL components",
    description:
      "Properly encode a string for use in a URL path segment or query parameter value, and decode encoded strings back. Handle the difference between encodeURIComponent and encodeURI.",
    difficulty: "easy",
    domain: ["encoding"],
    tags: ["url-encode", "percent-encode", "decode"],
  },

  // ── Validation ────────────────────────────────────────────────────────────
  {
    name: "Validate email address",
    description:
      "Return true if the string is a valid email address per RFC 5322 simplified rules: local@domain, local can contain dots/plus/hyphens, domain must have at least one dot.",
    difficulty: "easy",
    domain: ["validation"],
    tags: ["email", "validate", "regex"],
  },
  {
    name: "Validate and parse semver string",
    description:
      "Check if a string is a valid semver (MAJOR.MINOR.PATCH with optional pre-release and build metadata). If valid, return the parsed components; if not, return null.",
    difficulty: "easy",
    domain: ["validation"],
    tags: ["semver", "version", "parse", "validate"],
  },
  {
    name: "Validate UUID",
    description:
      "Return true if the string is a valid UUID in the standard 8-4-4-4-12 hex format. Optionally validate that it matches a specific version (v1, v4, v5).",
    difficulty: "easy",
    domain: ["validation"],
    tags: ["uuid", "validate", "regex"],
  },
  {
    name: "Validate IPv4 and IPv6 addresses",
    description:
      "Given a string, determine if it is a valid IPv4 address (dotted decimal), a valid IPv6 address (including compressed forms), or neither. Return the detected type.",
    difficulty: "easy",
    domain: ["validation"],
    tags: ["ip", "ipv4", "ipv6", "validate"],
  },
  {
    name: "Validate JSON schema (subset)",
    description:
      "Given a value and a JSON Schema object (supporting type, required, properties, items, minLength, maxLength, minimum, maximum, enum), return { valid, errors }.",
    difficulty: "hard",
    domain: ["validation"],
    tags: ["json-schema", "validate", "schema"],
  },
  {
    name: "Sanitize and validate file path",
    description:
      "Given an untrusted file path string, ensure it doesn't contain path traversal sequences (../) and is within an allowed root directory. Return the resolved absolute path or throw.",
    difficulty: "medium",
    domain: ["validation", "filesystem"],
    tags: ["path-traversal", "sanitize", "security"],
  },
  {
    name: "Validate environment variables against schema",
    description:
      "Given process.env and a schema (object mapping var names to { type, required, default }), return { valid, missing, invalid, resolved } where resolved contains coerced values.",
    difficulty: "medium",
    domain: ["validation", "env"],
    tags: ["env-vars", "config", "validate", "coerce"],
  },

  // ── Array / Collection ────────────────────────────────────────────────────
  {
    name: "Chunk array into pages",
    description:
      "Given an array and a page size, return an array of sub-arrays where each sub-array has at most pageSize elements. The last chunk may be smaller.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["chunk", "page", "batch", "split"],
  },
  {
    name: "Group array of objects by key",
    description:
      "Given an array of objects and a key name (or key-extractor function), return an object where each key maps to an array of items that share that key value.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["group-by", "partition", "map", "reduce"],
  },
  {
    name: "Deduplicate array preserving order",
    description:
      "Remove duplicate values from an array, keeping the first occurrence. Support a key extractor function for deduplicating arrays of objects.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["dedupe", "unique", "Set"],
  },
  {
    name: "Zip arrays into array of tuples",
    description:
      "Given N arrays, return an array of tuples where each tuple contains the elements from each input array at the same index. Stop at the shortest array (or pad with undefined for the longest).",
    difficulty: "easy",
    domain: ["array"],
    tags: ["zip", "tuple", "parallel"],
  },
  {
    name: "Flatten nested array to depth N",
    description:
      "Recursively flatten a nested array up to the given depth. Depth 1 is a shallow flatten; Infinity flattens completely. Return a new array.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["flatten", "recursive", "depth"],
  },
  {
    name: "Sliding window over array",
    description:
      "Given an array and a window size, return an array of overlapping sub-arrays of that size. Step size is configurable (default 1). Discard incomplete trailing windows unless padded.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["sliding-window", "window", "sequence"],
  },
  {
    name: "Compute running statistics over array",
    description:
      "Given a numeric array, return { min, max, mean, median, stddev, p50, p95, p99 }. Efficient single-pass where possible.",
    difficulty: "medium",
    domain: ["array"],
    tags: ["statistics", "percentile", "mean", "stddev"],
  },
  {
    name: "Topological sort of dependency graph",
    description:
      "Given a map of node → [dependencies], return a valid topological ordering. Detect and report cycles. Used to order tasks, build steps, or migrations.",
    difficulty: "hard",
    domain: ["array"],
    tags: ["topological-sort", "graph", "dag", "dependencies"],
  },
  {
    name: "Diff two arrays as changesets",
    description:
      "Given arrays A and B, return { added, removed, unchanged } — items in B not in A, items in A not in B, and items in both. Support a key extractor for comparing objects.",
    difficulty: "medium",
    domain: ["array"],
    tags: ["diff", "changeset", "set-operations"],
  },
  {
    name: "Binary search on sorted array",
    description:
      "Given a sorted array and a target value (or comparator), return the index of the target or the insertion point if not found. Optionally find the leftmost or rightmost match.",
    difficulty: "easy",
    domain: ["array"],
    tags: ["binary-search", "sorted", "search"],
  },

  // ── Filesystem (conceptual — operations agents perform on project files) ──
  {
    name: "List files matching glob patterns",
    description:
      "Given a root directory and one or more glob patterns, return all matching file paths relative to the root. Support negation patterns. Return paths sorted.",
    difficulty: "easy",
    domain: ["filesystem"],
    tags: ["glob", "files", "list", "pattern"],
  },
  {
    name: "Find files containing pattern",
    description:
      "Recursively search a directory for files whose content matches a regex pattern. Return { file, lineNumber, lineContent } for each match. Respect .gitignore by default.",
    difficulty: "medium",
    domain: ["filesystem"],
    tags: ["grep", "search", "regex", "files"],
  },
  {
    name: "Parse .env file",
    description:
      "Read a .env file and return a map of key→value pairs. Handle quoted values, multi-line values (with backslash continuation), inline comments, and export prefixes.",
    difficulty: "easy",
    domain: ["filesystem", "env"],
    tags: ["dotenv", "parse", "config"],
  },
  {
    name: "Read and parse CSV file",
    description:
      "Parse a CSV file into an array of objects, using the first row as headers. Handle quoted fields with embedded commas and newlines, and configurable delimiters.",
    difficulty: "medium",
    domain: ["filesystem"],
    tags: ["csv", "parse", "table", "data"],
  },
  {
    name: "Compute file hash",
    description:
      "Compute the MD5 or SHA-256 hash of a file's contents given its path. Stream the file rather than reading it all into memory. Return the hash as a hex string.",
    difficulty: "easy",
    domain: ["filesystem"],
    tags: ["hash", "md5", "sha256", "file", "stream"],
  },
  {
    name: "Atomic file write",
    description:
      "Write content to a file atomically: write to a temp file in the same directory, then rename to the target path. Prevents partial writes from being observed by concurrent readers.",
    difficulty: "easy",
    domain: ["filesystem"],
    tags: ["atomic", "write", "temp", "rename"],
  },

  // ── AWS SDK patterns ──────────────────────────────────────────────────────
  {
    name: "DynamoDB put item with condition",
    description:
      "Write an item to a DynamoDB table using PutCommand. If the item already exists (attribute_not_exists check), throw a conflict error. Return the written item.",
    difficulty: "easy",
    domain: ["aws", "dynamodb"],
    tags: ["put", "condition", "conflict", "dynamodb"],
  },
  {
    name: "DynamoDB query GSI with pagination",
    description:
      "Query a DynamoDB Global Secondary Index by partition key and optional sort key condition. Collect all pages automatically using LastEvaluatedKey. Return all items.",
    difficulty: "medium",
    domain: ["aws", "dynamodb"],
    tags: ["query", "gsi", "pagination", "dynamodb"],
  },
  {
    name: "DynamoDB transactional write",
    description:
      "Execute a DynamoDB TransactWriteItems call with multiple Put and Update operations. Handle TransactionCanceledException and return which condition failed.",
    difficulty: "medium",
    domain: ["aws", "dynamodb"],
    tags: ["transact", "atomic", "dynamodb"],
  },
  {
    name: "DynamoDB batch write items",
    description:
      "Write an array of items to DynamoDB in batches of 25 (the API limit). Retry unprocessed items with backoff. Return counts of successful and failed writes.",
    difficulty: "medium",
    domain: ["aws", "dynamodb"],
    tags: ["batch-write", "bulk", "unprocessed", "dynamodb"],
  },
  {
    name: "Publish events to Kinesis stream",
    description:
      "Given an array of event records, publish them to a Kinesis stream in batches of 500 (the API limit). Use the event ID as the partition key. Handle FailedRecordCount.",
    difficulty: "medium",
    domain: ["aws", "kinesis"],
    tags: ["kinesis", "publish", "batch", "events"],
  },
  {
    name: "Get secret from Secrets Manager with cache",
    description:
      "Retrieve a secret value from AWS Secrets Manager. Cache the result in memory for the Lambda instance lifetime. Parse JSON secrets automatically. Support rotation by re-fetching on a configurable TTL.",
    difficulty: "medium",
    domain: ["aws"],
    tags: ["secrets-manager", "cache", "credentials"],
  },
  {
    name: "Invoke Lambda function and parse response",
    description:
      "Invoke an AWS Lambda function synchronously (RequestResponse). Parse the response payload as JSON. Detect function errors (FunctionError header) and throw with the error detail.",
    difficulty: "easy",
    domain: ["aws"],
    tags: ["lambda", "invoke", "parse", "error"],
  },
  {
    name: "S3 put and get with content type",
    description:
      "Put a string or Buffer to an S3 key with the correct ContentType header. Get the object and return the body as a Buffer or parsed JSON. Handle NoSuchKey gracefully.",
    difficulty: "easy",
    domain: ["aws", "s3"],
    tags: ["s3", "put", "get", "content-type"],
  },
  {
    name: "SQS send and receive with visibility timeout",
    description:
      "Send a message to an SQS queue. Receive messages with a configurable visibility timeout and max count. Delete a message by receipt handle after processing.",
    difficulty: "easy",
    domain: ["aws", "sqs"],
    tags: ["sqs", "send", "receive", "delete"],
  },
  {
    name: "CloudWatch put custom metric",
    description:
      "Publish a custom CloudWatch metric with a namespace, metric name, value, unit, and optional dimensions. Batch multiple metrics into a single PutMetricData call.",
    difficulty: "easy",
    domain: ["aws"],
    tags: ["cloudwatch", "metrics", "monitoring"],
  },

  // ── Code / AST inspection ─────────────────────────────────────────────────
  {
    name: "Extract import paths from TypeScript file",
    description:
      "Given TypeScript source code as a string, extract all import paths (from 'import X from ...' and 'import(...)' expressions). Return paths as an array, deduplicated.",
    difficulty: "easy",
    domain: ["code"],
    tags: ["typescript", "imports", "ast", "static-analysis"],
  },
  {
    name: "Extract exported names from TypeScript module",
    description:
      "Given TypeScript source code, return all exported identifiers (functions, classes, constants, types, interfaces). Distinguish value exports from type-only exports.",
    difficulty: "medium",
    domain: ["code"],
    tags: ["typescript", "exports", "ast", "module"],
  },
  {
    name: "Detect programming language from file extension",
    description:
      "Given a filename or file extension, return the canonical language name and its ecosystem (e.g. '.ts' → { language: 'TypeScript', ecosystem: 'node' }). Cover at least 30 common languages.",
    difficulty: "easy",
    domain: ["code"],
    tags: ["language-detection", "extension", "metadata"],
  },
  {
    name: "Count lines of code by type",
    description:
      "Given source code as a string and the language name, count: total lines, code lines, comment lines, and blank lines. Support single-line and multi-line comment styles.",
    difficulty: "medium",
    domain: ["code"],
    tags: ["loc", "cloc", "comments", "metrics"],
  },
  {
    name: "Find TODO and FIXME comments",
    description:
      "Scan source code for TODO, FIXME, HACK, and NOTE comments. Return each match with the line number, comment text, and any ticket reference found inline (e.g. 'TODO(#123)').",
    difficulty: "easy",
    domain: ["code"],
    tags: ["todo", "fixme", "comments", "scan"],
  },
  {
    name: "Parse package.json and resolve dependency ranges",
    description:
      "Read package.json from a path, extract all dependencies (dependencies, devDependencies, peerDependencies), and classify each version range as exact, caret, tilde, range, or wildcard.",
    difficulty: "easy",
    domain: ["code"],
    tags: ["package.json", "dependencies", "semver", "npm"],
  },
  {
    name: "Generate TypeScript interface from JSON sample",
    description:
      "Given a JSON value (object, array, or primitive), generate a TypeScript interface or type alias that describes its shape. Handle nested objects, optional fields (from nullable values), and arrays.",
    difficulty: "hard",
    domain: ["code"],
    tags: ["typescript", "codegen", "interface", "inference"],
  },

  // ── Process / Environment ─────────────────────────────────────────────────
  {
    name: "Run shell command with timeout",
    description:
      "Execute a shell command as a child process. Capture stdout and stderr separately. Kill the process if it exceeds a timeout. Return { stdout, stderr, exitCode, timedOut }.",
    difficulty: "medium",
    domain: ["env"],
    tags: ["shell", "exec", "timeout", "process"],
    constraints: "timeout in milliseconds; command is a string or string array",
  },
  {
    name: "Build shell command string safely",
    description:
      "Given a command name and an array of arguments, construct a shell-escaped command string safe for display and logging. Never use this output in eval — use it for logging only.",
    difficulty: "easy",
    domain: ["env"],
    tags: ["shell", "escape", "command", "logging"],
  },
  {
    name: "Deep clone with structured clone or fallback",
    description:
      "Deep clone a value using structuredClone if available (Node 17+), falling back to JSON round-trip for plain objects. Handle Date, RegExp, Map, and Set correctly.",
    difficulty: "easy",
    domain: ["env"],
    tags: ["clone", "deep-copy", "structured-clone"],
  },
  {
    name: "Concurrent task runner with concurrency limit",
    description:
      "Given an array of async tasks (functions returning Promises) and a concurrency limit, run at most N tasks simultaneously. Return results in input order. Propagate all errors.",
    difficulty: "medium",
    domain: ["env"],
    tags: ["concurrency", "p-limit", "async", "queue"],
  },
  {
    name: "Memoize async function with TTL",
    description:
      "Wrap an async function so repeated calls with the same arguments return a cached promise. Entries expire after a configurable TTL. Cache key derived from JSON-serialized arguments.",
    difficulty: "medium",
    domain: ["env"],
    tags: ["memoize", "cache", "ttl", "async"],
  },
  {
    name: "Debounce and throttle function calls",
    description:
      "Debounce: delay execution until N ms after the last call. Throttle: allow at most one call per N ms. Both should handle async functions and support a cancel method.",
    difficulty: "medium",
    domain: ["env"],
    tags: ["debounce", "throttle", "rate-limit", "timing"],
  },

  // ── Logging / Observability ───────────────────────────────────────────────
  {
    name: "Structured JSON logger",
    description:
      "Build a logger that emits newline-delimited JSON with level, timestamp (ISO8601), message, and arbitrary context fields. Support log levels (debug, info, warn, error) with a configurable minimum level.",
    difficulty: "easy",
    domain: ["logging"],
    tags: ["logger", "json", "structured", "ndjson"],
  },
  {
    name: "Redact sensitive fields from log object",
    description:
      "Given a log object and a list of sensitive field names (e.g. ['password', 'token', 'secret']), return a new object with those field values replaced by '[REDACTED]'. Recurse into nested objects and arrays.",
    difficulty: "easy",
    domain: ["logging"],
    tags: ["redact", "sensitive", "privacy", "logging"],
  },
  {
    name: "Correlate log lines by request ID",
    description:
      "Given an array of structured log lines (JSON objects with a request_id field), group them by request_id and return an array of correlated traces sorted by timestamp.",
    difficulty: "easy",
    domain: ["logging"],
    tags: ["correlation", "request-id", "trace", "group"],
  },
  {
    name: "Compute p50/p95/p99 from latency samples",
    description:
      "Given an array of latency measurements in milliseconds, compute p50, p95, and p99 percentiles. Use a sorting-based approach for accuracy. Optionally compute a histogram with configurable bucket size.",
    difficulty: "easy",
    domain: ["logging"],
    tags: ["percentile", "latency", "p99", "histogram"],
  },

  // ── AI / Agent patterns ───────────────────────────────────────────────────
  {
    name: "Cosine similarity between two vectors",
    description:
      "Compute the cosine similarity between two numeric arrays of equal length. Used for embedding-based semantic search. Return a value in [-1, 1]. Handle zero-vectors without division by zero.",
    difficulty: "easy",
    domain: ["ai"],
    tags: ["cosine-similarity", "embedding", "vector", "search"],
  },
  {
    name: "Top-K nearest neighbors by cosine similarity",
    description:
      "Given a query embedding (number[]) and a list of { id, embedding } candidates, return the top K candidates sorted by cosine similarity descending. Efficient for lists up to ~5000 items.",
    difficulty: "medium",
    domain: ["ai"],
    tags: ["knn", "nearest-neighbor", "embedding", "search"],
  },
  {
    name: "Token count estimator for LLM context",
    description:
      "Given a string, estimate the number of LLM tokens it contains using the 4-chars-per-token heuristic, then refine with word-boundary splitting. Return an estimate without requiring a tokenizer library.",
    difficulty: "easy",
    domain: ["ai"],
    tags: ["tokens", "llm", "context-length", "estimate"],
  },
  {
    name: "Truncate prompt to fit token budget",
    description:
      "Given a prompt string and a max token count, truncate the prompt to fit within the budget. Prefer truncating at sentence or paragraph boundaries. Append a truncation notice if truncated.",
    difficulty: "medium",
    domain: ["ai"],
    tags: ["prompt", "truncate", "token-budget", "llm"],
  },
  {
    name: "Extract structured data from LLM response",
    description:
      "Given an LLM response string that may contain a JSON block (inside ```json ... ``` or as bare JSON), extract and parse the JSON. Fall back to a provided default on parse failure.",
    difficulty: "easy",
    domain: ["ai"],
    tags: ["llm", "json-extraction", "parse", "structured-output"],
  },
  {
    name: "Chunk document for embedding",
    description:
      "Split a long document into overlapping chunks suitable for embedding and semantic search. Target chunk size in tokens (estimated), with configurable overlap. Return chunks with start/end character offsets.",
    difficulty: "medium",
    domain: ["ai"],
    tags: ["chunking", "embedding", "rag", "document"],
  },
];

async function seedProblems() {
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;

  for (const seed of PROBLEMS) {
    const problem = {
      problem_id: uuidv4(),
      name: seed.name,
      description: seed.description,
      difficulty: seed.difficulty,
      domain: seed.domain,
      tags: seed.tags,
      ...(seed.constraints !== undefined ? { constraints: seed.constraints } : {}),
      examples: [],
      canonical_skill_id: null,
      skill_count: 0,
      status: "active",
      domain_primary: seed.domain[0],
      created_at: now,
      updated_at: now,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: problem,
          ConditionExpression: "attribute_not_exists(problem_id)",
        }),
      );
      console.log(`  ✓ ${seed.name}`);
      created++;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        console.log(`  ~ ${seed.name} (already exists)`);
        skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}, Total: ${PROBLEMS.length}`);
}

seedProblems().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
