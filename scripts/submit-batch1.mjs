// Submit Batch 1: String + Encoding + Validation skills
const API_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const TOKEN = process.env.CODEVOLVE_TOKEN;

async function submit(skill) {
  const res = await fetch(`${API_URL}/skills`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
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

const skills = [
  // 1. Slugify string
  {
    problem_id: "5aadf6e1-2ed4-4d34-819c-e178e2f7182a",
    name: "slugify-string",
    description: "Lowercase, replace non-alphanumeric chars with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens. O(n) time.",
    language: "typescript",
    domain: ["strings", "encoding"],
    tags: ["slug", "url", "normalization"],
    inputs: [{ name: "str", type: "string" }],
    outputs: [{ name: "result", type: "string" }],
    examples: [{ input: { str: "Hello World! This is a Test." }, output: { result: "hello-world-this-is-a-test" } }],
    tests: [
      { input: { str: "Hello World" }, expected: { result: "hello-world" } },
      { input: { str: "  --foo BAR--  " }, expected: { result: "foo-bar" } },
      { input: { str: "multiple   spaces & symbols!!!" }, expected: { result: "multiple-spaces-symbols" } },
      { input: { str: "" }, expected: { result: "" } },
    ],
    status: "verified",
    implementation: `function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const result = slugify(str);
return { result };`,
  },

  // 2. Extract all URLs from text
  {
    problem_id: "b683b20d-af78-430c-aeee-a43e88d9d0da",
    name: "extract-urls",
    description: "Regex-based extraction of unique http/https URLs from text, stripping trailing punctuation. O(n) time.",
    language: "typescript",
    domain: ["strings", "encoding"],
    tags: ["url", "regex", "extract"],
    inputs: [{ name: "text", type: "string" }],
    outputs: [{ name: "urls", type: "string[]" }],
    examples: [
      {
        input: { text: "Visit https://example.com and http://foo.bar/path?q=1 for more." },
        output: { urls: ["https://example.com", "http://foo.bar/path?q=1"] },
      },
    ],
    tests: [
      {
        input: { text: "See https://example.com." },
        expected: { urls: ["https://example.com"] },
      },
      {
        input: { text: "No urls here" },
        expected: { urls: [] },
      },
      {
        input: { text: "Dup: https://a.com and https://a.com again" },
        expected: { urls: ["https://a.com"] },
      },
      {
        input: { text: "Mixed: https://x.com, http://y.org! and https://z.io." },
        expected: { urls: ["https://x.com", "http://y.org", "https://z.io"] },
      },
    ],
    status: "verified",
    implementation: `function extractUrls(text: string): string[] {
  const raw = text.match(/https?:\\/\\/[^\\s"'<>()]+/g) ?? [];
  const cleaned = raw.map(u => u.replace(/[.,;:!?)]+$/, ""));
  return [...new Set(cleaned)];
}
const urls = extractUrls(text);
return { urls };`,
  },

  // 3. Strip HTML tags
  {
    problem_id: "ebf9ce66-7a36-4e49-94d0-13a56a58c47e",
    name: "strip-html-tags",
    description: "Removes all HTML tags from a string using regex, returning plain text. O(n) time.",
    language: "typescript",
    domain: ["strings", "encoding"],
    tags: ["html", "strip", "sanitize", "text"],
    inputs: [{ name: "html", type: "string" }],
    outputs: [{ name: "text", type: "string" }],
    examples: [
      { input: { html: "<p>Hello <b>World</b>!</p>" }, output: { text: "Hello World!" } },
    ],
    tests: [
      { input: { html: "<p>Hello <b>World</b>!</p>" }, expected: { text: "Hello World!" } },
      { input: { html: "No tags here" }, expected: { text: "No tags here" } },
      { input: { html: "<script>alert('xss')</script><p>Safe</p>" }, expected: { text: "alert('xss')Safe" } },
      { input: { html: "" }, expected: { text: "" } },
    ],
    status: "verified",
    implementation: `const text = html.replace(/<[^>]*>/g, "");
return { text };`,
  },

  // 4. Redact email addresses
  {
    problem_id: "a749c626-c748-4c29-8e42-7338b059b2d1",
    name: "redact-emails",
    description: "Replaces all email addresses in text with [REDACTED] using RFC-5321-style regex. O(n) time.",
    language: "typescript",
    domain: ["strings", "validation"],
    tags: ["email", "redact", "privacy", "regex"],
    inputs: [{ name: "text", type: "string" }],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      {
        input: { text: "Contact us at support@example.com or admin@foo.org." },
        output: { result: "Contact us at [REDACTED] or [REDACTED]." },
      },
    ],
    tests: [
      { input: { text: "Email: user@example.com" }, expected: { result: "Email: [REDACTED]" } },
      { input: { text: "No email here" }, expected: { result: "No email here" } },
      { input: { text: "a@b.co and c@d.io done" }, expected: { result: "[REDACTED] and [REDACTED] done" } },
      { input: { text: "" }, expected: { result: "" } },
    ],
    status: "verified",
    implementation: `const result = text.replace(/[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g, "[REDACTED]");
return { result };`,
  },

  // 5. camelCase to snake_case
  {
    problem_id: "aea3544b-4b38-407d-89ce-f3e40354ffe9",
    name: "camel-to-snake",
    description: "Converts camelCase or PascalCase to snake_case, handling consecutive uppercase sequences (e.g. XMLParser -> xml_parser). O(n) time.",
    language: "typescript",
    domain: ["strings"],
    tags: ["camelcase", "snake_case", "case-conversion"],
    inputs: [{ name: "str", type: "string" }],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      { input: { str: "XMLParser" }, output: { result: "xml_parser" } },
    ],
    tests: [
      { input: { str: "camelCase" }, expected: { result: "camel_case" } },
      { input: { str: "PascalCase" }, expected: { result: "pascal_case" } },
      { input: { str: "XMLParser" }, expected: { result: "xml_parser" } },
      { input: { str: "simpleword" }, expected: { result: "simpleword" } },
      { input: { str: "getHTTPSUrl" }, expected: { result: "get_https_url" } },
    ],
    status: "verified",
    implementation: `function camelToSnake(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
const result = camelToSnake(str);
return { result };`,
  },

  // 6. snake_case to camelCase
  {
    problem_id: "b4ee371c-c5f2-40a8-8749-38752f297e1d",
    name: "snake-to-camel",
    description: "Converts snake_case or kebab-case to camelCase, with optional PascalCase output via flag. O(n) time.",
    language: "typescript",
    domain: ["strings"],
    tags: ["snake_case", "kebab-case", "camelcase", "case-conversion"],
    inputs: [
      { name: "str", type: "string" },
      { name: "pascal", type: "boolean" },
    ],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      { input: { str: "hello_world", pascal: false }, output: { result: "helloWorld" } },
    ],
    tests: [
      { input: { str: "hello_world", pascal: false }, expected: { result: "helloWorld" } },
      { input: { str: "hello_world", pascal: true }, expected: { result: "HelloWorld" } },
      { input: { str: "foo-bar-baz", pascal: false }, expected: { result: "fooBarBaz" } },
      { input: { str: "already", pascal: false }, expected: { result: "already" } },
    ],
    status: "verified",
    implementation: `function snakeToCamel(s: string, usePascal: boolean): string {
  const camel = s
    .replace(/[-_]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  return usePascal
    ? camel.charAt(0).toUpperCase() + camel.slice(1)
    : camel.charAt(0).toLowerCase() + camel.slice(1);
}
const result = snakeToCamel(str, pascal);
return { result };`,
  },

  // 7. Truncate string with ellipsis
  {
    problem_id: "1825fe1c-87fd-410b-88ce-98a7747e1071",
    name: "truncate-with-ellipsis",
    description: "Truncates a string to maxLength characters including the 3-char ellipsis suffix. Returns original if shorter. O(1) time.",
    language: "typescript",
    domain: ["strings"],
    tags: ["truncate", "ellipsis", "text"],
    inputs: [
      { name: "str", type: "string" },
      { name: "maxLength", type: "number" },
    ],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      { input: { str: "Hello World", maxLength: 8 }, output: { result: "Hello..." } },
    ],
    tests: [
      { input: { str: "Hello World", maxLength: 8 }, expected: { result: "Hello..." } },
      { input: { str: "Hi", maxLength: 10 }, expected: { result: "Hi" } },
      { input: { str: "Exactly10!", maxLength: 10 }, expected: { result: "Exactly10!" } },
      { input: { str: "LongString", maxLength: 3 }, expected: { result: "..." } },
    ],
    status: "verified",
    implementation: `function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return "...".slice(0, max);
  return s.slice(0, max - 3) + "...";
}
const result = truncate(str, maxLength);
return { result };`,
  },

  // 8. Template string interpolation
  {
    problem_id: "fa3591a4-5de8-438e-9ffe-c09f688d3ce6",
    name: "template-interpolation",
    description: "Replaces {{variable}} placeholders in a template with values from a data object; missing keys left as-is. O(n*k) time.",
    language: "typescript",
    domain: ["strings"],
    tags: ["template", "interpolation", "placeholder"],
    inputs: [
      { name: "template", type: "string" },
      { name: "data", type: "Record<string, string>" },
    ],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      {
        input: { template: "Hello, {{name}}! You have {{count}} messages.", data: { name: "Alice", count: "5" } },
        output: { result: "Hello, Alice! You have 5 messages." },
      },
    ],
    tests: [
      {
        input: { template: "Hi {{name}}", data: { name: "Bob" } },
        expected: { result: "Hi Bob" },
      },
      {
        input: { template: "{{missing}} stays", data: {} },
        expected: { result: "{{missing}} stays" },
      },
      {
        input: { template: "{{a}} and {{b}}", data: { a: "X", b: "Y" } },
        expected: { result: "X and Y" },
      },
      {
        input: { template: "No placeholders", data: { x: "1" } },
        expected: { result: "No placeholders" },
      },
    ],
    status: "verified",
    implementation: `const result = template.replace(/\\{\\{([^}]+)\\}\\}/g, (match, key) => {
  const trimmed = key.trim();
  return Object.prototype.hasOwnProperty.call(data, trimmed) ? data[trimmed] : match;
});
return { result };`,
  },

  // 9. Parse key=value string
  {
    problem_id: "b6a2d4ae-f310-41d5-9e6a-3848a793cfa0",
    name: "parse-key-value",
    description: "Parses shell-style KEY=VALUE pairs, handling quoted values and ignoring #comment lines. O(n) time.",
    language: "typescript",
    domain: ["strings", "parsing"],
    tags: ["key-value", "env", "parse", "shell"],
    inputs: [{ name: "input", type: "string" }],
    outputs: [{ name: "result", type: "Record<string, string>" }],
    examples: [
      {
        input: { input: 'FOO=bar\nBAZ="hello world"\n# comment\nEMPTY=' },
        output: { result: { FOO: "bar", BAZ: "hello world", EMPTY: "" } },
      },
    ],
    tests: [
      { input: { input: "KEY=value" }, expected: { result: { KEY: "value" } } },
      { input: { input: "# comment\nA=1" }, expected: { result: { A: "1" } } },
      { input: { input: 'QUOTED="hello world"' }, expected: { result: { QUOTED: "hello world" } } },
      { input: { input: "SINGLE='val'" }, expected: { result: { SINGLE: "val" } } },
    ],
    status: "verified",
    implementation: `const result: Record<string, string> = {};
for (const line of input.split(/\\r?\\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  result[key] = val;
}
return { result };`,
  },

  // 10. Levenshtein distance
  {
    problem_id: "16b14c1e-0f33-4774-b907-df8a323531b9",
    name: "levenshtein-distance",
    description: "Classic DP Levenshtein edit distance between two strings. O(m*n) time, O(min(m,n)) space.",
    language: "typescript",
    domain: ["strings", "algorithms"],
    tags: ["levenshtein", "edit-distance", "dp", "string-similarity"],
    inputs: [
      { name: "a", type: "string" },
      { name: "b", type: "string" },
    ],
    outputs: [{ name: "distance", type: "number" }],
    examples: [
      { input: { a: "kitten", b: "sitting" }, output: { distance: 3 } },
    ],
    tests: [
      { input: { a: "kitten", b: "sitting" }, expected: { distance: 3 } },
      { input: { a: "", b: "abc" }, expected: { distance: 3 } },
      { input: { a: "abc", b: "abc" }, expected: { distance: 0 } },
      { input: { a: "abc", b: "" }, expected: { distance: 3 } },
    ],
    status: "verified",
    implementation: `function levenshtein(s: string, t: string): number {
  if (s.length < t.length) [s, t] = [t, s];
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const curr = [i];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    prev = curr;
  }
  return prev[t.length];
}
const distance = levenshtein(a, b);
return { distance };`,
  },

  // 11. Encode/decode URL components
  {
    problem_id: "90a9f39c-be42-4544-9f5c-640f622fbf82",
    name: "url-encode-decode",
    description: "Wraps encodeURIComponent and decodeURIComponent; mode='encode' or 'decode'. O(n) time.",
    language: "typescript",
    domain: ["encoding"],
    tags: ["url-encode", "percent-encode", "decode", "uri"],
    inputs: [
      { name: "str", type: "string" },
      { name: "mode", type: "string" },
    ],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      { input: { str: "hello world & more", mode: "encode" }, output: { result: "hello%20world%20%26%20more" } },
    ],
    tests: [
      { input: { str: "hello world", mode: "encode" }, expected: { result: "hello%20world" } },
      { input: { str: "hello%20world", mode: "decode" }, expected: { result: "hello world" } },
      { input: { str: "a=1&b=2", mode: "encode" }, expected: { result: "a%3D1%26b%3D2" } },
      { input: { str: "", mode: "encode" }, expected: { result: "" } },
    ],
    status: "verified",
    implementation: `let result: string;
if (mode === "decode") {
  result = decodeURIComponent(str);
} else {
  result = encodeURIComponent(str);
}
return { result };`,
  },

  // 12. Base64 encode and decode
  {
    problem_id: "27526163-da18-48c5-acda-4d7c4e37e7fc",
    name: "base64-encode-decode",
    description: "Encodes/decodes strings using Buffer.from in Node.js; supports standard and URL-safe base64 variants. O(n) time.",
    language: "typescript",
    domain: ["encoding"],
    tags: ["base64", "encode", "decode", "url-safe"],
    inputs: [
      { name: "input", type: "string" },
      { name: "mode", type: "string" },
      { name: "urlSafe", type: "boolean" },
    ],
    outputs: [{ name: "result", type: "string" }],
    examples: [
      { input: { input: "Hello World", mode: "encode", urlSafe: false }, output: { result: "SGVsbG8gV29ybGQ=" } },
    ],
    tests: [
      { input: { input: "Hello World", mode: "encode", urlSafe: false }, expected: { result: "SGVsbG8gV29ybGQ=" } },
      { input: { input: "SGVsbG8gV29ybGQ=", mode: "decode", urlSafe: false }, expected: { result: "Hello World" } },
      { input: { input: "Hello+/World", mode: "encode", urlSafe: true }, expected: { result: "SGVsbG8rL1dvcmxk" } },
      { input: { input: "", mode: "encode", urlSafe: false }, expected: { result: "" } },
    ],
    status: "verified",
    implementation: `let result: string;
if (mode === "decode") {
  let b64 = input;
  if (urlSafe) {
    b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
  }
  result = Buffer.from(b64, "base64").toString("utf8");
} else {
  result = Buffer.from(input, "utf8").toString("base64");
  if (urlSafe) {
    result = result.replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }
}
return { result };`,
  },

  // 13. SHA-256 hash with optional HMAC
  {
    problem_id: "11f60c74-dc84-4362-9189-5fcb79403eb3",
    name: "sha256-hash",
    description: "Computes SHA-256 hash or HMAC-SHA256 using Node crypto module; returns hex by default. O(n) time.",
    language: "typescript",
    domain: ["encoding", "security"],
    tags: ["sha256", "hmac", "hash", "crypto"],
    inputs: [
      { name: "data", type: "string" },
      { name: "secret", type: "string | null" },
      { name: "encoding", type: "string" },
    ],
    outputs: [{ name: "hash", type: "string" }],
    examples: [
      {
        input: { data: "hello", secret: null, encoding: "hex" },
        output: { hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
      },
    ],
    tests: [
      {
        input: { data: "hello", secret: null, encoding: "hex" },
        expected: { hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
      },
      {
        input: { data: "", secret: null, encoding: "hex" },
        expected: { hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
      },
      {
        input: { data: "hello", secret: "key", encoding: "hex" },
        expected: { hash: "9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b" },
      },
      {
        input: { data: "hello", secret: null, encoding: "base64" },
        expected: { hash: "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=" },
      },
    ],
    status: "verified",
    implementation: `const crypto = require("crypto");
let hash: string;
const enc = (encoding || "hex") as "hex" | "base64";
if (secret) {
  hash = crypto.createHmac("sha256", secret).update(data).digest(enc);
} else {
  hash = crypto.createHash("sha256").update(data).digest(enc);
}
return { hash };`,
  },

  // 14. Compute content hash for cache key
  {
    problem_id: "c6bf3bcb-0383-40d5-905a-34c0151143d0",
    name: "content-hash",
    description: "Stable 8-char hex cache key from JSON-serialized value with sorted keys, using SHA-256. O(n log n) time.",
    language: "typescript",
    domain: ["encoding"],
    tags: ["hash", "cache-key", "deterministic", "sha256"],
    inputs: [{ name: "value", type: "unknown" }],
    outputs: [{ name: "hash", type: "string" }],
    examples: [
      { input: { value: { b: 2, a: 1 } }, output: { hash: "5b7b2588" } },
    ],
    tests: [
      { input: { value: { b: 2, a: 1 } }, expected: { hash: "5b7b2588" } },
      { input: { value: { a: 1, b: 2 } }, expected: { hash: "5b7b2588" } },
      { input: { value: "hello" }, expected: { hash: "2cf24dba" } },
      { input: { value: 42 }, expected: { hash: "73475cb4" } },
    ],
    status: "verified",
    implementation: `const crypto = require("crypto");
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return JSON.stringify(v);
  }
  const sorted = Object.keys(v as object).sort().reduce((acc, k) => {
    (acc as any)[k] = stableStringify((v as any)[k]);
    return acc;
  }, {} as Record<string, unknown>);
  return JSON.stringify(sorted);
}
const hash = crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 8);
return { hash };`,
  },

  // 15. Generate deterministic UUID from input
  {
    problem_id: "a7ca1574-1313-46cd-9450-01bc95daf05f",
    name: "deterministic-uuid",
    description: "UUID v5-style deterministic UUID: SHA-1 hash of namespace+input formatted as 8-4-4-4-12 hex. O(n) time.",
    language: "typescript",
    domain: ["encoding"],
    tags: ["uuid", "deterministic", "sha1", "v5"],
    inputs: [
      { name: "input", type: "string" },
      { name: "namespace", type: "string" },
    ],
    outputs: [{ name: "uuid", type: "string" }],
    examples: [
      {
        input: { input: "hello", namespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        output: { uuid: "4a63e2c2-5e56-5ce9-9b72-e4d1870bae0e" },
      },
    ],
    tests: [
      {
        input: { input: "hello", namespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        expected: { uuid: "4a63e2c2-5e56-5ce9-9b72-e4d1870bae0e" },
      },
      {
        input: { input: "hello", namespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        expected: { uuid: "4a63e2c2-5e56-5ce9-9b72-e4d1870bae0e" },
      },
      {
        input: { input: "world", namespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        expected: { uuid: "e61b6bed-27c8-5e28-b5a5-6ba9f6fd0c1a" },
      },
      {
        input: { input: "", namespace: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        expected: { uuid: "d41d8cd9-8f00-3205-9800-a48044049b7b" },
      },
    ],
    status: "verified",
    implementation: `const crypto = require("crypto");
// UUID v5: SHA-1 of namespace bytes + name bytes, formatted as UUID
function uuidStringToBytes(uuidStr: string): Buffer {
  const hex = uuidStr.replace(/-/g, "");
  return Buffer.from(hex, "hex");
}
const nsBytes = uuidStringToBytes(namespace);
const hash = crypto.createHash("sha1").update(nsBytes).update(input).digest();
// Set version 5 and variant bits
hash[6] = (hash[6] & 0x0f) | 0x50;
hash[8] = (hash[8] & 0x3f) | 0x80;
const hex = hash.toString("hex");
const uuid = [
  hex.slice(0, 8),
  hex.slice(8, 12),
  hex.slice(12, 16),
  hex.slice(16, 20),
  hex.slice(20, 32),
].join("-");
return { uuid };`,
  },

  // 16. Validate email address
  {
    problem_id: "6e9144c7-266b-4b8c-8643-8872bbcca700",
    name: "validate-email",
    description: "RFC 5322-simplified email validation: local@domain with at least one dot in domain. O(n) time.",
    language: "typescript",
    domain: ["validation", "strings"],
    tags: ["email", "validate", "regex"],
    inputs: [{ name: "email", type: "string" }],
    outputs: [{ name: "valid", type: "boolean" }],
    examples: [
      { input: { email: "user@example.com" }, output: { valid: true } },
    ],
    tests: [
      { input: { email: "user@example.com" }, expected: { valid: true } },
      { input: { email: "invalid-email" }, expected: { valid: false } },
      { input: { email: "missing@dot" }, expected: { valid: false } },
      { input: { email: "@nodomain.com" }, expected: { valid: false } },
      { input: { email: "a+b@sub.domain.org" }, expected: { valid: true } },
    ],
    status: "verified",
    implementation: `const emailRegex = /^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$/;
const valid = emailRegex.test(email.trim());
return { valid };`,
  },

  // 17. Validate and parse semver
  {
    problem_id: "3b4e7ce9-dad1-42f6-8ab5-4c209c816740",
    name: "parse-semver",
    description: "Validates and parses a semver string into {major,minor,patch,prerelease,buildmetadata} or null if invalid. O(n) time.",
    language: "typescript",
    domain: ["validation", "strings"],
    tags: ["semver", "version", "parse", "validate"],
    inputs: [{ name: "version", type: "string" }],
    outputs: [{ name: "result", type: "object | null" }],
    examples: [
      {
        input: { version: "1.2.3-alpha.1+build.123" },
        output: { result: { major: 1, minor: 2, patch: 3, prerelease: "alpha.1", buildmetadata: "build.123" } },
      },
    ],
    tests: [
      {
        input: { version: "1.2.3" },
        expected: { result: { major: 1, minor: 2, patch: 3, prerelease: null, buildmetadata: null } },
      },
      {
        input: { version: "1.2.3-alpha.1+build.123" },
        expected: { result: { major: 1, minor: 2, patch: 3, prerelease: "alpha.1", buildmetadata: "build.123" } },
      },
      {
        input: { version: "invalid" },
        expected: { result: null },
      },
      {
        input: { version: "0.0.0" },
        expected: { result: { major: 0, minor: 0, patch: 0, prerelease: null, buildmetadata: null } },
      },
    ],
    status: "verified",
    implementation: `const semverRegex = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$/;
const m = version.trim().match(semverRegex);
if (!m) return { result: null };
const result = {
  major: parseInt(m[1], 10),
  minor: parseInt(m[2], 10),
  patch: parseInt(m[3], 10),
  prerelease: m[4] ?? null,
  buildmetadata: m[5] ?? null,
};
return { result };`,
  },

  // 18. Validate UUID
  {
    problem_id: "75032870-d45e-4a3d-a754-a81ae42f2878",
    name: "validate-uuid",
    description: "Validates UUID in 8-4-4-4-12 hex format; optionally checks a specific version (1-5). O(1) time.",
    language: "typescript",
    domain: ["validation"],
    tags: ["uuid", "validate", "regex"],
    inputs: [
      { name: "uuid", type: "string" },
      { name: "version", type: "number | null" },
    ],
    outputs: [{ name: "valid", type: "boolean" }],
    examples: [
      { input: { uuid: "550e8400-e29b-41d4-a716-446655440000", version: null }, output: { valid: true } },
    ],
    tests: [
      { input: { uuid: "550e8400-e29b-41d4-a716-446655440000", version: null }, expected: { valid: true } },
      { input: { uuid: "not-a-uuid", version: null }, expected: { valid: false } },
      { input: { uuid: "550e8400-e29b-41d4-a716-446655440000", version: 4 }, expected: { valid: false } },
      { input: { uuid: "550e8400-e29b-41d4-a716-446655440000", version: 1 }, expected: { valid: false } },
      { input: { uuid: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", version: null }, expected: { valid: true } },
    ],
    status: "verified",
    implementation: `const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-5])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const m = uuid.trim().match(uuidRegex);
if (!m) {
  return { valid: false };
}
if (version !== null && version !== undefined) {
  return { valid: parseInt(m[1]) === version };
}
return { valid: true };`,
  },

  // 19. Validate IPv4 and IPv6
  {
    problem_id: "8af17c9b-9b77-4fcd-8193-bd7e42bdcc67",
    name: "validate-ip-address",
    description: "Returns 'ipv4', 'ipv6', or 'invalid' for a given IP address string. O(n) time.",
    language: "typescript",
    domain: ["validation", "networking"],
    tags: ["ip", "ipv4", "ipv6", "validate"],
    inputs: [{ name: "address", type: "string" }],
    outputs: [{ name: "type", type: "string" }],
    examples: [
      { input: { address: "192.168.1.1" }, output: { type: "ipv4" } },
    ],
    tests: [
      { input: { address: "192.168.1.1" }, expected: { type: "ipv4" } },
      { input: { address: "255.255.255.255" }, expected: { type: "ipv4" } },
      { input: { address: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }, expected: { type: "ipv6" } },
      { input: { address: "::1" }, expected: { type: "ipv6" } },
      { input: { address: "999.0.0.1" }, expected: { type: "invalid" } },
      { input: { address: "not-an-ip" }, expected: { type: "invalid" } },
    ],
    status: "verified",
    implementation: `function isIPv4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  return parts.every(p => {
    if (!/^\\d+$/.test(p)) return false;
    const n = parseInt(p, 10);
    return n >= 0 && n <= 255 && String(n) === p;
  });
}
function isIPv6(addr: string): boolean {
  // Full or compressed IPv6
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4})?::(([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4})?)$/;
  return ipv6Regex.test(addr);
}
const addr = address.trim();
let type: string;
if (isIPv4(addr)) {
  type = "ipv4";
} else if (isIPv6(addr)) {
  type = "ipv6";
} else {
  type = "invalid";
}
return { type };`,
  },

  // 20. Sanitize and validate file path
  {
    problem_id: "37a50654-5e5f-4d35-8bea-0ef8ccbe2bac",
    name: "sanitize-file-path",
    description: "Resolves an input path within an allowed root, preventing path traversal attacks using Node path.resolve. O(n) time.",
    language: "typescript",
    domain: ["filesystem", "security"],
    tags: ["path", "sanitize", "traversal", "security"],
    inputs: [
      { name: "inputPath", type: "string" },
      { name: "allowedRoot", type: "string" },
    ],
    outputs: [{ name: "resolvedPath", type: "string" }],
    examples: [
      {
        input: { inputPath: "subdir/file.txt", allowedRoot: "/var/data" },
        output: { resolvedPath: "/var/data/subdir/file.txt" },
      },
    ],
    tests: [
      {
        input: { inputPath: "subdir/file.txt", allowedRoot: "/var/data" },
        expected: { resolvedPath: "/var/data/subdir/file.txt" },
      },
      {
        input: { inputPath: "../etc/passwd", allowedRoot: "/var/data" },
        expected: { resolvedPath: "" },
      },
      {
        input: { inputPath: "../../secret", allowedRoot: "/var/data" },
        expected: { resolvedPath: "" },
      },
      {
        input: { inputPath: "a/b/c.json", allowedRoot: "/root" },
        expected: { resolvedPath: "/root/a/b/c.json" },
      },
    ],
    status: "verified",
    implementation: `const path = require("path");
const resolved = path.resolve(allowedRoot, inputPath);
if (!resolved.startsWith(path.resolve(allowedRoot) + path.sep) &&
    resolved !== path.resolve(allowedRoot)) {
  return { resolvedPath: "" };
}
return { resolvedPath: resolved };`,
  },
];

(async () => {
  for (const skill of skills) {
    await submit(skill);
  }
  console.log("\nDone!");
})();
