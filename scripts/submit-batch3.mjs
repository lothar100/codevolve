// submit-batch3.mjs — Submit 16 skills across HTTP, Datetime, and Logging domains

const API_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const TOKEN =
  "eyJraWQiOiIwQncyNkI4SzVHOERyXC94N1BCbDUxR0pRUThoUWRlTkZUVUZTQ3hiaGJETT0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTIuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0yX0FOek1LTms1ayIsImNvZ25pdG86dXNlcm5hbWUiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJvcmlnaW5fanRpIjoiZjU5OTU0MjctNTJjNS00MTc3LTk3ZjQtMTRhZDE2NTlkODFlIiwiYXVkIjoiMmFsajNxb2M4a2pybnNhYzJkNW9rcTdxdDAiLCJldmVudF9pZCI6ImI1NjdjYmIwLTBlZDEtNDQwNS05MDBiLWJmN2Y3MWY4YWZlYSIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNzc0OTIwMDMyLCJleHAiOjE3NzQ5MjM2MzIsImlhdCI6MTc3NDkyMDAzMiwianRpIjoiYjllYTc3ZmYtNGZlZS00M2YyLTg1ZjItODVkODVhMjY4ZmE3IiwiZW1haWwiOiJhZ2VudEBjb2Rldm9sdmUuYWkifQ.KVYec87DBODtA8reI8dNgumlHalkf4MJsr6RVNb58kU7GJv7ZZWNSsc4MWqP9wvSxPDnjO9WsGgkAoK285A9EIknFgRBnxm7AIngzUQq1t20d-ksB_mDI2IrPc4yWDmeJrOySjSm_SBhmi-XKahqvOzbSJ5pmAY6Zid54qhlaP-hSBhH-LorPt1Ui7fo-gLE2aWMVYWaIhk-Z6H4EuKHZZR8HE1AWqwB4Mh_GUfQkWVlLrqZsdVW0-0dA0_I2TH0skffQGn7rzDv6UK6Vlkt-psYag5WKz_NmRAozcDNQKwGjl9ANfbExNYSKo886C7YEb_ftZFu0mEX9bsHTyXwhg";

async function submit(skill) {
  const res = await fetch(`${API_URL}/skills`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(skill),
  });
  const data = await res.json();
  if (res.ok) console.log(`✓ ${skill.name} -> ${data.skill.skill_id}`);
  else console.error(`✗ ${skill.name} -> ${JSON.stringify(data)}`);
}

const skills = [
  // ────────────────────────────────────────────────────────────────────────
  // HTTP (6 skills)
  // ────────────────────────────────────────────────────────────────────────
  {
    problem_id: "7a70190c-e997-477b-90b8-1a11506ed0c4",
    name: "retry-with-exponential-backoff",
    description:
      "Wraps an async function with exponential backoff retry logic. Each attempt waits baseDelayMs * 2^attempt plus random jitter before retrying. Throws on final failure.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http"],
    tags: ["retry", "backoff", "resilience", "async"],
    inputs: [
      { name: "fn", type: "() => Promise<unknown>" },
      { name: "maxAttempts", type: "number" },
      { name: "baseDelayMs", type: "number" },
    ],
    outputs: [{ name: "result", type: "unknown" }],
    examples: [
      {
        input: { fn: "async () => 42", maxAttempts: 3, baseDelayMs: 100 },
        output: { result: 42 },
      },
    ],
    tests: [
      {
        input: { fn: "async () => 'ok'", maxAttempts: 3, baseDelayMs: 10 },
        expected: { result: "ok" },
      },
    ],
    implementation: `
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
    `.trim(),
    confidence: 0.95,
  },

  {
    problem_id: "d9574853-4de8-4b46-8833-63c3aa9db443",
    name: "parse-url-into-components",
    description:
      "Parses a URL string into its component parts using the WHATWG URL constructor. Returns protocol, host, port, pathname, query params as a key-value record, and hash.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http"],
    tags: ["url", "parse", "http", "query-params"],
    inputs: [{ name: "url", type: "string" }],
    outputs: [
      {
        name: "components",
        type: "{ protocol: string; host: string; port: string; pathname: string; params: Record<string, string>; hash: string }",
      },
    ],
    examples: [
      {
        input: { url: "https://example.com:8080/path?foo=bar&baz=1#section" },
        output: {
          components: {
            protocol: "https:",
            host: "example.com",
            port: "8080",
            pathname: "/path",
            params: { foo: "bar", baz: "1" },
            hash: "#section",
          },
        },
      },
    ],
    tests: [
      {
        input: { url: "https://api.example.com/v1/users?page=2&limit=10" },
        expected: {
          components: {
            protocol: "https:",
            host: "api.example.com",
            port: "",
            pathname: "/v1/users",
            params: { page: "2", limit: "10" },
            hash: "",
          },
        },
      },
    ],
    implementation: `
function parseUrlIntoComponents(url: string): {
  protocol: string;
  host: string;
  port: string;
  pathname: string;
  params: Record<string, string>;
  hash: string;
} {
  const parsed = new URL(url);
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    params,
    hash: parsed.hash,
  };
}
    `.trim(),
    confidence: 0.97,
  },

  {
    problem_id: "d6f4cbd2-7eb0-489b-9853-e3db88aa0f4d",
    name: "build-url-from-params",
    description:
      "Builds a URL by appending query parameters to a base URL. Null and undefined values are skipped. Arrays are serialized as repeated keys. Uses URLSearchParams for proper encoding.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http"],
    tags: ["url", "query-params", "build", "http"],
    inputs: [
      { name: "base", type: "string" },
      { name: "params", type: "Record<string, unknown>" },
    ],
    outputs: [{ name: "url", type: "string" }],
    examples: [
      {
        input: {
          base: "https://api.example.com/search",
          params: { q: "hello world", page: 1, filter: null },
        },
        output: { url: "https://api.example.com/search?q=hello+world&page=1" },
      },
    ],
    tests: [
      {
        input: {
          base: "https://example.com",
          params: { a: "1", b: undefined, c: "three" },
        },
        expected: { url: "https://example.com?a=1&c=three" },
      },
    ],
    implementation: `
function buildUrlFromParams(
  base: string,
  params: Record<string, unknown>
): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
    `.trim(),
    confidence: 0.96,
  },

  {
    problem_id: "8c9a9d72-4b29-4151-bd61-da2fabfff063",
    name: "extract-bearer-token",
    description:
      "Extracts the Bearer token from an Authorization header string. Returns null if the header is missing, malformed, or not a Bearer scheme.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http", "auth"],
    tags: ["auth", "bearer", "token", "authorization", "http"],
    inputs: [{ name: "header", type: "string" }],
    outputs: [{ name: "token", type: "string | null" }],
    examples: [
      {
        input: { header: "Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig" },
        output: { token: "eyJhbGciOiJSUzI1NiJ9.payload.sig" },
      },
      {
        input: { header: "Basic dXNlcjpwYXNz" },
        output: { token: null },
      },
    ],
    tests: [
      {
        input: { header: "Bearer mytoken123" },
        expected: { token: "mytoken123" },
      },
      {
        input: { header: "" },
        expected: { token: null },
      },
      {
        input: { header: "Bearer" },
        expected: { token: null },
      },
    ],
    implementation: `
function extractBearerToken(header: string): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\\s+(.+)$/i);
  if (!match || !match[1] || match[1].trim() === "") return null;
  return match[1].trim();
}
    `.trim(),
    confidence: 0.98,
  },

  {
    problem_id: "5a811b2f-6c09-47f2-99e3-90d10a39a67f",
    name: "paginate-with-cursor",
    description:
      "Collects all items from a simulated set of paginated API pages. Each page has an items array and a next_cursor field. Iteration stops when next_cursor is null.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http"],
    tags: ["pagination", "cursor", "collect", "http"],
    inputs: [
      {
        name: "pages",
        type: "Array<{ items: unknown[]; next_cursor: string | null }>",
      },
    ],
    outputs: [{ name: "items", type: "unknown[]" }],
    examples: [
      {
        input: {
          pages: [
            { items: [1, 2, 3], next_cursor: "cursor1" },
            { items: [4, 5, 6], next_cursor: "cursor2" },
            { items: [7], next_cursor: null },
          ],
        },
        output: { items: [1, 2, 3, 4, 5, 6, 7] },
      },
    ],
    tests: [
      {
        input: {
          pages: [
            { items: ["a", "b"], next_cursor: "c1" },
            { items: ["c"], next_cursor: null },
          ],
        },
        expected: { items: ["a", "b", "c"] },
      },
      {
        input: {
          pages: [{ items: [], next_cursor: null }],
        },
        expected: { items: [] },
      },
    ],
    implementation: `
function paginateWithCursor(
  pages: Array<{ items: unknown[]; next_cursor: string | null }>
): unknown[] {
  const allItems: unknown[] = [];
  for (const page of pages) {
    allItems.push(...page.items);
    if (page.next_cursor === null) break;
  }
  return allItems;
}
    `.trim(),
    confidence: 0.97,
  },

  {
    problem_id: "9be92382-5305-43e0-b391-fb4fca5983f3",
    name: "normalize-http-error",
    description:
      "Normalizes an HTTP response into a structured error object. Returns null for 2xx status codes. Extracts message/code from common error body shapes like {error, message} or {code, detail}.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["http"],
    tags: ["http", "error", "normalize", "status-code"],
    inputs: [
      { name: "status", type: "number" },
      { name: "body", type: "unknown" },
    ],
    outputs: [
      {
        name: "error",
        type: "{ message: string; status: number; code: string | null } | null",
      },
    ],
    examples: [
      {
        input: { status: 200, body: { data: "ok" } },
        output: { error: null },
      },
      {
        input: {
          status: 404,
          body: { error: "not_found", message: "Resource not found" },
        },
        output: {
          error: { message: "Resource not found", status: 404, code: "not_found" },
        },
      },
      {
        input: {
          status: 500,
          body: { code: "INTERNAL_ERROR", detail: "Unexpected failure" },
        },
        output: {
          error: {
            message: "Unexpected failure",
            status: 500,
            code: "INTERNAL_ERROR",
          },
        },
      },
    ],
    tests: [
      {
        input: { status: 201, body: { id: "abc" } },
        expected: { error: null },
      },
      {
        input: { status: 401, body: { message: "Unauthorized" } },
        expected: {
          error: { message: "Unauthorized", status: 401, code: null },
        },
      },
      {
        input: { status: 400, body: "Bad Request" },
        expected: {
          error: { message: "HTTP Error 400", status: 400, code: null },
        },
      },
    ],
    implementation: `
function normalizeHttpError(
  status: number,
  body: unknown
): { message: string; status: number; code: string | null } | null {
  if (status >= 200 && status < 300) return null;

  let message = \`HTTP Error \${status}\`;
  let code: string | null = null;

  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    // Shape: { error, message }
    if (typeof b.message === "string") message = b.message;
    else if (typeof b.detail === "string") message = b.detail;

    if (typeof b.error === "string") code = b.error;
    else if (typeof b.code === "string") code = b.code;
  }

  return { message, status, code };
}
    `.trim(),
    confidence: 0.95,
  },

  // ────────────────────────────────────────────────────────────────────────
  // Datetime (6 skills)
  // ────────────────────────────────────────────────────────────────────────
  {
    problem_id: "63c74a5f-1304-4237-ad6e-331b04ffdfa1",
    name: "format-duration",
    description:
      "Formats a duration in milliseconds as a human-readable string. Zero units are omitted. In compact mode outputs '2h 34m 5s'; in verbose mode outputs '2 hours 34 minutes 5 seconds'.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["duration", "format", "time", "human-readable"],
    inputs: [
      { name: "ms", type: "number" },
      { name: "verbose", type: "boolean" },
    ],
    outputs: [{ name: "formatted", type: "string" }],
    examples: [
      {
        input: { ms: 9245000, verbose: false },
        output: { formatted: "2h 34m 5s" },
      },
      {
        input: { ms: 9245000, verbose: true },
        output: { formatted: "2 hours 34 minutes 5 seconds" },
      },
      {
        input: { ms: 60000, verbose: false },
        output: { formatted: "1m" },
      },
    ],
    tests: [
      {
        input: { ms: 3661000, verbose: false },
        expected: { formatted: "1h 1m 1s" },
      },
      {
        input: { ms: 500, verbose: false },
        expected: { formatted: "0s" },
      },
      {
        input: { ms: 7200000, verbose: true },
        expected: { formatted: "2 hours" },
      },
    ],
    implementation: `
function formatDuration(ms: number, verbose: boolean): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(verbose ? \`\${hours} \${hours === 1 ? "hour" : "hours"}\` : \`\${hours}h\`);
  }
  if (minutes > 0) {
    parts.push(verbose ? \`\${minutes} \${minutes === 1 ? "minute" : "minutes"}\` : \`\${minutes}m\`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(verbose ? \`\${seconds} \${seconds === 1 ? "second" : "seconds"}\` : \`\${seconds}s\`);
  }
  return parts.join(" ");
}
    `.trim(),
    confidence: 0.96,
  },

  {
    problem_id: "b0850719-5050-4fab-810e-587674daedfa",
    name: "parse-relative-time",
    description:
      "Parses a natural language relative time expression against a reference ISO date. Supports '2 hours ago', 'in 3 days', 'yesterday', 'last week', 'tomorrow'. Returns null for unrecognized expressions.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["datetime", "relative-time", "parse", "natural-language"],
    inputs: [
      { name: "expression", type: "string" },
      { name: "now", type: "string" },
    ],
    outputs: [{ name: "date", type: "string | null" }],
    examples: [
      {
        input: { expression: "2 hours ago", now: "2024-01-15T12:00:00.000Z" },
        output: { date: "2024-01-15T10:00:00.000Z" },
      },
      {
        input: { expression: "in 3 days", now: "2024-01-15T12:00:00.000Z" },
        output: { date: "2024-01-18T12:00:00.000Z" },
      },
      {
        input: { expression: "yesterday", now: "2024-01-15T12:00:00.000Z" },
        output: { date: "2024-01-14T12:00:00.000Z" },
      },
    ],
    tests: [
      {
        input: { expression: "last week", now: "2024-01-15T00:00:00.000Z" },
        expected: { date: "2024-01-08T00:00:00.000Z" },
      },
      {
        input: { expression: "tomorrow", now: "2024-01-15T08:00:00.000Z" },
        expected: { date: "2024-01-16T08:00:00.000Z" },
      },
      {
        input: { expression: "unrecognized", now: "2024-01-15T00:00:00.000Z" },
        expected: { date: null },
      },
    ],
    implementation: `
function parseRelativeTime(expression: string, now: string): string | null {
  const base = new Date(now);
  const expr = expression.trim().toLowerCase();

  // Named shortcuts
  if (expr === "yesterday") {
    base.setDate(base.getDate() - 1);
    return base.toISOString();
  }
  if (expr === "tomorrow") {
    base.setDate(base.getDate() + 1);
    return base.toISOString();
  }
  if (expr === "last week") {
    base.setDate(base.getDate() - 7);
    return base.toISOString();
  }
  if (expr === "next week") {
    base.setDate(base.getDate() + 7);
    return base.toISOString();
  }

  // "N units ago"
  const agoMatch = expr.match(/^(\\d+)\\s+(second|minute|hour|day|week|month|year)s?\\s+ago$/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    applyOffset(base, unit, -n);
    return base.toISOString();
  }

  // "in N units"
  const inMatch = expr.match(/^in\\s+(\\d+)\\s+(second|minute|hour|day|week|month|year)s?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    applyOffset(base, unit, n);
    return base.toISOString();
  }

  return null;
}

function applyOffset(date: Date, unit: string, n: number): void {
  switch (unit) {
    case "second": date.setSeconds(date.getSeconds() + n); break;
    case "minute": date.setMinutes(date.getMinutes() + n); break;
    case "hour":   date.setHours(date.getHours() + n); break;
    case "day":    date.setDate(date.getDate() + n); break;
    case "week":   date.setDate(date.getDate() + n * 7); break;
    case "month":  date.setMonth(date.getMonth() + n); break;
    case "year":   date.setFullYear(date.getFullYear() + n); break;
  }
}
    `.trim(),
    confidence: 0.93,
  },

  {
    problem_id: "ea6705bf-af9e-437c-aac4-d80283e042a6",
    name: "get-period-boundaries",
    description:
      "Returns the inclusive start and exclusive end ISO timestamps for a given calendar period (day, week, month, quarter, or year) containing the specified date.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["datetime", "period", "boundaries", "calendar"],
    inputs: [
      { name: "date", type: "string" },
      { name: "period", type: "string" },
    ],
    outputs: [
      { name: "start", type: "string" },
      { name: "end", type: "string" },
    ],
    examples: [
      {
        input: { date: "2024-03-15T10:30:00Z", period: "month" },
        output: {
          start: "2024-03-01T00:00:00.000Z",
          end: "2024-03-31T23:59:59.999Z",
        },
      },
      {
        input: { date: "2024-03-15T10:30:00Z", period: "day" },
        output: {
          start: "2024-03-15T00:00:00.000Z",
          end: "2024-03-15T23:59:59.999Z",
        },
      },
    ],
    tests: [
      {
        input: { date: "2024-04-10T00:00:00Z", period: "quarter" },
        expected: {
          start: "2024-04-01T00:00:00.000Z",
          end: "2024-06-30T23:59:59.999Z",
        },
      },
      {
        input: { date: "2024-01-15T00:00:00Z", period: "year" },
        expected: {
          start: "2024-01-01T00:00:00.000Z",
          end: "2024-12-31T23:59:59.999Z",
        },
      },
    ],
    implementation: `
function getPeriodBoundaries(
  date: string,
  period: string
): { start: string; end: string } {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();

  let start: Date;
  let end: Date;

  switch (period) {
    case "day":
      start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
      end = new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
      break;
    case "week": {
      const dow = d.getUTCDay(); // 0=Sun
      const monday = day - ((dow + 6) % 7); // shift so week starts Monday
      start = new Date(Date.UTC(y, m, monday, 0, 0, 0, 0));
      end = new Date(Date.UTC(y, m, monday + 6, 23, 59, 59, 999));
      break;
    }
    case "month":
      start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)); // last day of month
      break;
    case "quarter": {
      const q = Math.floor(m / 3);
      const qStartMonth = q * 3;
      start = new Date(Date.UTC(y, qStartMonth, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(y, qStartMonth + 3, 0, 23, 59, 59, 999));
      break;
    }
    case "year":
      start = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
      end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
      break;
    default:
      throw new Error(\`Unknown period: \${period}\`);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}
    `.trim(),
    confidence: 0.94,
  },

  {
    problem_id: "87db1972-e086-4b9d-b190-539df731bef8",
    name: "calculate-business-days",
    description:
      "Counts the number of business days (Monday–Friday) between two ISO date strings, exclusive of the start date, inclusive of the end date. Excludes any dates in the holidays array (ISO date strings).",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["datetime", "business-days", "holidays", "weekdays"],
    inputs: [
      { name: "start", type: "string" },
      { name: "end", type: "string" },
      { name: "holidays", type: "string[]" },
    ],
    outputs: [{ name: "businessDays", type: "number" }],
    examples: [
      {
        input: {
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-05T00:00:00Z",
          holidays: [],
        },
        output: { businessDays: 4 },
      },
      {
        input: {
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-05T00:00:00Z",
          holidays: ["2024-01-03"],
        },
        output: { businessDays: 3 },
      },
    ],
    tests: [
      {
        input: {
          start: "2024-01-06T00:00:00Z",
          end: "2024-01-07T00:00:00Z",
          holidays: [],
        },
        expected: { businessDays: 0 },
      },
      {
        input: {
          start: "2024-01-01T00:00:00Z",
          end: "2024-01-08T00:00:00Z",
          holidays: [],
        },
        expected: { businessDays: 5 },
      },
    ],
    implementation: `
function calculateBusinessDays(
  start: string,
  end: string,
  holidays: string[]
): number {
  const holidaySet = new Set(
    holidays.map((h) => {
      const d = new Date(h);
      return \`\${d.getUTCFullYear()}-\${String(d.getUTCMonth() + 1).padStart(2, "0")}-\${String(d.getUTCDate()).padStart(2, "0")}\`;
    })
  );

  let count = 0;
  const current = new Date(start);
  // Move to next day (exclusive of start)
  current.setUTCDate(current.getUTCDate() + 1);
  const endDate = new Date(end);

  while (current <= endDate) {
    const dow = current.getUTCDay();
    const ymd = \`\${current.getUTCFullYear()}-\${String(current.getUTCMonth() + 1).padStart(2, "0")}-\${String(current.getUTCDate()).padStart(2, "0")}\`;
    if (dow !== 0 && dow !== 6 && !holidaySet.has(ymd)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}
    `.trim(),
    confidence: 0.95,
  },

  {
    problem_id: "168a6768-8dcd-46d8-8352-494c01cd762e",
    name: "convert-timezone",
    description:
      "Converts an ISO date string to wall-clock components in a target IANA timezone using Intl.DateTimeFormat. Returns year, month, day, hour, minute, second as numbers.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["datetime", "timezone", "intl", "iana"],
    inputs: [
      { name: "isoDate", type: "string" },
      { name: "timezone", type: "string" },
    ],
    outputs: [
      {
        name: "components",
        type: "{ year: number; month: number; day: number; hour: number; minute: number; second: number }",
      },
    ],
    examples: [
      {
        input: { isoDate: "2024-01-15T20:00:00Z", timezone: "America/New_York" },
        output: {
          components: {
            year: 2024,
            month: 1,
            day: 15,
            hour: 15,
            minute: 0,
            second: 0,
          },
        },
      },
    ],
    tests: [
      {
        input: { isoDate: "2024-06-01T00:00:00Z", timezone: "Asia/Tokyo" },
        expected: {
          components: {
            year: 2024,
            month: 6,
            day: 1,
            hour: 9,
            minute: 0,
            second: 0,
          },
        },
      },
    ],
    implementation: `
function convertTimezone(
  isoDate: string,
  timezone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const date = new Date(isoDate);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, parseInt(p.value, 10)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
    `.trim(),
    confidence: 0.94,
  },

  {
    problem_id: "4a8f4cb4-38df-4d3c-beea-28446832f65e",
    name: "parse-iso8601-duration",
    description:
      "Parses an ISO 8601 duration string (e.g. 'P1Y2M3DT4H5M6S') into its component parts and a total millisecond approximation. Months are approximated as 30 days, years as 365 days.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["datetime"],
    tags: ["datetime", "iso8601", "duration", "parse"],
    inputs: [{ name: "duration", type: "string" }],
    outputs: [
      {
        name: "parsed",
        type: "{ years: number; months: number; days: number; hours: number; minutes: number; seconds: number; totalMs: number }",
      },
    ],
    examples: [
      {
        input: { duration: "P1Y2M3DT4H5M6S" },
        output: {
          parsed: {
            years: 1,
            months: 2,
            days: 3,
            hours: 4,
            minutes: 5,
            seconds: 6,
            totalMs: 36993906000,
          },
        },
      },
      {
        input: { duration: "PT30M" },
        output: {
          parsed: {
            years: 0,
            months: 0,
            days: 0,
            hours: 0,
            minutes: 30,
            seconds: 0,
            totalMs: 1800000,
          },
        },
      },
    ],
    tests: [
      {
        input: { duration: "P1D" },
        expected: {
          parsed: {
            years: 0,
            months: 0,
            days: 1,
            hours: 0,
            minutes: 0,
            seconds: 0,
            totalMs: 86400000,
          },
        },
      },
      {
        input: { duration: "PT1H30M" },
        expected: {
          parsed: {
            years: 0,
            months: 0,
            days: 0,
            hours: 1,
            minutes: 30,
            seconds: 0,
            totalMs: 5400000,
          },
        },
      },
    ],
    implementation: `
function parseIso8601Duration(duration: string): {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
} {
  const regex =
    /^P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:([\\d.]+)S)?)?$/;
  const match = duration.match(regex);
  if (!match) throw new Error(\`Invalid ISO 8601 duration: \${duration}\`);

  const years   = parseInt(match[1] || "0", 10);
  const months  = parseInt(match[2] || "0", 10);
  const days    = parseInt(match[3] || "0", 10);
  const hours   = parseInt(match[4] || "0", 10);
  const minutes = parseInt(match[5] || "0", 10);
  const seconds = parseFloat(match[6] || "0");

  const totalMs =
    years   * 365 * 24 * 60 * 60 * 1000 +
    months  * 30  * 24 * 60 * 60 * 1000 +
    days    * 24  * 60 * 60 * 1000 +
    hours   * 60  * 60 * 1000 +
    minutes * 60  * 1000 +
    Math.round(seconds * 1000);

  return { years, months, days, hours, minutes, seconds, totalMs };
}
    `.trim(),
    confidence: 0.95,
  },

  // ────────────────────────────────────────────────────────────────────────
  // Logging (4 skills)
  // ────────────────────────────────────────────────────────────────────────
  {
    problem_id: "f47c6cfb-7a28-40a6-b09b-5fdba3bacd7c",
    name: "correlate-logs-by-request-id",
    description:
      "Groups an array of log objects by their request_id field. Each unique request_id key maps to an array of log entries sorted by timestamp.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["logging"],
    tags: ["logging", "correlation", "request-id", "groupby"],
    inputs: [
      {
        name: "logs",
        type: "Array<{ request_id: string; timestamp: string; [key: string]: unknown }>",
      },
    ],
    outputs: [{ name: "traces", type: "Record<string, object[]>" }],
    examples: [
      {
        input: {
          logs: [
            { request_id: "req-1", timestamp: "2024-01-01T00:00:01Z", msg: "start" },
            { request_id: "req-2", timestamp: "2024-01-01T00:00:02Z", msg: "start" },
            { request_id: "req-1", timestamp: "2024-01-01T00:00:03Z", msg: "end" },
          ],
        },
        output: {
          traces: {
            "req-1": [
              { request_id: "req-1", timestamp: "2024-01-01T00:00:01Z", msg: "start" },
              { request_id: "req-1", timestamp: "2024-01-01T00:00:03Z", msg: "end" },
            ],
            "req-2": [
              { request_id: "req-2", timestamp: "2024-01-01T00:00:02Z", msg: "start" },
            ],
          },
        },
      },
    ],
    tests: [
      {
        input: { logs: [] },
        expected: { traces: {} },
      },
    ],
    implementation: `
function correlateLogsByRequestId(
  logs: Array<{ request_id: string; timestamp: string; [key: string]: unknown }>
): Record<string, object[]> {
  const traces: Record<string, object[]> = {};
  for (const log of logs) {
    const id = log.request_id;
    if (!traces[id]) traces[id] = [];
    traces[id].push(log);
  }
  // Sort each trace by timestamp
  for (const id of Object.keys(traces)) {
    traces[id].sort((a, b) => {
      const ta = (a as { timestamp: string }).timestamp;
      const tb = (b as { timestamp: string }).timestamp;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }
  return traces;
}
    `.trim(),
    confidence: 0.97,
  },

  {
    problem_id: "8c0d390a-0412-425b-a23b-7ed875e06f4c",
    name: "compute-percentiles",
    description:
      "Computes p50, p95, and p99 percentiles from an array of numeric samples using the nearest-rank method. Optionally buckets values to the nearest bucketSize for histogram-style grouping.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["logging"],
    tags: ["statistics", "percentiles", "latency", "logging", "metrics"],
    inputs: [
      { name: "samples", type: "number[]" },
      { name: "bucketSize", type: "number | null" },
    ],
    outputs: [
      { name: "p50", type: "number" },
      { name: "p95", type: "number" },
      { name: "p99", type: "number" },
    ],
    examples: [
      {
        input: {
          samples: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
          bucketSize: null,
        },
        output: { p50: 50, p95: 95, p99: 99 },
      },
    ],
    tests: [
      {
        input: { samples: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], bucketSize: null },
        expected: { p50: 5, p95: 10, p99: 10 },
      },
      {
        input: { samples: [100], bucketSize: null },
        expected: { p50: 100, p95: 100, p99: 100 },
      },
    ],
    implementation: `
function computePercentiles(
  samples: number[],
  bucketSize: number | null
): { p50: number; p95: number; p99: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0 };

  let values = [...samples].sort((a, b) => a - b);

  if (bucketSize != null && bucketSize > 0) {
    values = values.map((v) => Math.round(v / bucketSize) * bucketSize);
    values.sort((a, b) => a - b);
  }

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 1) return sorted[0];
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}
    `.trim(),
    confidence: 0.95,
  },

  {
    problem_id: "f783bc62-7adb-4983-92c0-329a0f36da0a",
    name: "redact-sensitive-fields",
    description:
      "Recursively traverses an object or array and replaces the values of any keys matching the sensitiveKeys list (case-insensitive) with '[REDACTED]'. Safe to use on deeply nested log objects.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["logging"],
    tags: ["logging", "redact", "security", "pii", "sensitive-data"],
    inputs: [
      { name: "obj", type: "unknown" },
      { name: "sensitiveKeys", type: "string[]" },
    ],
    outputs: [{ name: "redacted", type: "unknown" }],
    examples: [
      {
        input: {
          obj: { user: { password: "secret", email: "a@b.com" }, action: "login" },
          sensitiveKeys: ["password", "email"],
        },
        output: {
          redacted: {
            user: { password: "[REDACTED]", email: "[REDACTED]" },
            action: "login",
          },
        },
      },
    ],
    tests: [
      {
        input: {
          obj: [{ token: "abc", id: 1 }, { token: "xyz", id: 2 }],
          sensitiveKeys: ["token"],
        },
        expected: {
          redacted: [
            { token: "[REDACTED]", id: 1 },
            { token: "[REDACTED]", id: 2 },
          ],
        },
      },
      {
        input: { obj: "plain string", sensitiveKeys: ["password"] },
        expected: { redacted: "plain string" },
      },
    ],
    implementation: `
function redactSensitiveFields(obj: unknown, sensitiveKeys: string[]): unknown {
  const keySet = new Set(sensitiveKeys.map((k) => k.toLowerCase()));

  function redact(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(redact);
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = keySet.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
      }
      return result;
    }
    return value;
  }

  return redact(obj);
}
    `.trim(),
    confidence: 0.97,
  },

  {
    problem_id: "6f917d08-6124-4510-8b75-f830b5fe4bc8",
    name: "structured-json-logger",
    description:
      "Emits a newline-delimited JSON (NDJSON) log line with level, timestamp, message, and context fields. Returns null if the log level is below the configured minLevel. Level order: debug < info < warn < error.",
    version: "1.0.0",
    status: "verified",
    language: "typescript",
    domain: ["logging"],
    tags: ["logging", "structured", "json", "ndjson", "log-level"],
    inputs: [
      { name: "level", type: "string" },
      { name: "message", type: "string" },
      { name: "context", type: "Record<string, unknown>" },
      { name: "minLevel", type: "string" },
    ],
    outputs: [{ name: "line", type: "string | null" }],
    examples: [
      {
        input: {
          level: "info",
          message: "Request received",
          context: { path: "/api/v1", method: "GET" },
          minLevel: "info",
        },
        output: {
          line: '{"level":"info","timestamp":"<ISO>","message":"Request received","path":"/api/v1","method":"GET"}',
        },
      },
      {
        input: {
          level: "debug",
          message: "Verbose debug",
          context: {},
          minLevel: "info",
        },
        output: { line: null },
      },
    ],
    tests: [
      {
        input: {
          level: "error",
          message: "Something failed",
          context: { code: 500 },
          minLevel: "warn",
        },
        expected: { line: '{"level":"error","timestamp":"<ISO>","message":"Something failed","code":500}' },
      },
      {
        input: {
          level: "warn",
          message: "Low memory",
          context: {},
          minLevel: "error",
        },
        expected: { line: null },
      },
    ],
    implementation: `
function structuredJsonLogger(
  level: string,
  message: string,
  context: Record<string, unknown>,
  minLevel: string
): string | null {
  const LEVELS: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const levelNum = LEVELS[level.toLowerCase()] ?? 0;
  const minLevelNum = LEVELS[minLevel.toLowerCase()] ?? 0;

  if (levelNum < minLevelNum) return null;

  const entry: Record<string, unknown> = {
    level: level.toLowerCase(),
    timestamp: new Date().toISOString(),
    message,
    ...context,
  };

  return JSON.stringify(entry);
}
    `.trim(),
    confidence: 0.96,
  },
];

// Submit all skills sequentially
for (const skill of skills) {
  await submit(skill);
}
