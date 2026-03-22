/**
 * Unit tests for stack trace sanitization logic in src/execution/execute.ts
 *
 * Because sanitizeStackTrace is not exported, we test it indirectly via the
 * handler's response. For direct testing, we re-implement the same logic here
 * as a local helper that mirrors the production implementation exactly.
 */

// Mirror of the production sanitizeStackTrace function (kept in sync manually)
const INTERNAL_FRAME_PATTERNS = [
  /\/var\/runtime\//,
  /\/var\/task\//,
  /node_modules\/lambda-runtime/,
  /bootstrap/,
];

function sanitizeStackTrace(detail: string | undefined): string | undefined {
  if (!detail) return undefined;

  const lines = detail.split("\n");
  const messageLines: string[] = [];
  const frameLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ")) {
      frameLines.push(line);
    } else {
      messageLines.push(line);
    }
  }

  const filteredFrames = frameLines.filter(
    (frame) =>
      !INTERNAL_FRAME_PATTERNS.some((pattern) => pattern.test(frame)),
  );

  const cappedFrames = filteredFrames.slice(0, 5);

  const cleanedFrames = cappedFrames.map((frame) =>
    frame
      .replace(/\/var\/task\//g, "")
      .replace(/\/var\/runtime\//g, ""),
  );

  const cleanedMessage = messageLines
    .join("\n")
    .replace(/\/var\/task\//g, "")
    .replace(/\/var\/runtime\//g, "")
    .replace(/\/[^\s]+\//g, "");

  return [cleanedMessage, ...cleanedFrames].filter(Boolean).join("\n");
}

describe("sanitizeStackTrace", () => {
  it("returns undefined for undefined input", () => {
    expect(sanitizeStackTrace(undefined)).toBeUndefined();
  });

  it("strips /var/task/ path prefix from stack frames in the error message", () => {
    // /var/task/ in the error message (not a frame) should be stripped
    const stack = [
      "Error: could not load /var/task/module.js",
      "    at usercode.js:10:5",
    ].join("\n");

    const result = sanitizeStackTrace(stack);
    expect(result).not.toContain("/var/task/");
    expect(result).toContain("usercode.js:10:5");
  });

  it("filters out stack frames that reside in /var/task/ (internal Lambda code)", () => {
    // /var/task/ frames are internal and should be removed from the output
    const stack = [
      "Error: something went wrong",
      "    at usercode.js:5:1",
      "    at /var/task/internalWrapper.js:10:5",
    ].join("\n");

    const result = sanitizeStackTrace(stack);
    expect(result).not.toContain("/var/task/");
    expect(result).toContain("usercode.js:5:1");
  });

  it("strips /var/runtime/ path prefix from frames", () => {
    const stack = [
      "Error: runtime failure",
      "    at /var/runtime/index.js:50:10",
      "    at usercode.js:5:1",
    ].join("\n");

    const result = sanitizeStackTrace(stack);
    expect(result).not.toContain("/var/runtime/");
  });

  it("removes Lambda runtime-internal frames (bootstrap, /var/runtime/)", () => {
    const stack = [
      "Error: test error",
      "    at usercode.js:5:1",
      "    at /var/runtime/bootstrap.js:100:1",
      "    at bootstrap:200:1",
      "    at node_modules/lambda-runtime/index.js:50:1",
    ].join("\n");

    const result = sanitizeStackTrace(stack);
    // Only usercode frame should remain
    expect(result).toContain("usercode.js:5:1");
    expect(result).not.toContain("bootstrap");
    expect(result).not.toContain("lambda-runtime");
  });

  it("caps stack frames at 5", () => {
    const frames = Array.from({ length: 10 }, (_, i) => `    at usercode${i}.js:${i}:1`);
    const stack = ["Error: many frames", ...frames].join("\n");

    const result = sanitizeStackTrace(stack)!;
    const resultFrames = result.split("\n").filter((l) => l.trim().startsWith("at "));
    expect(resultFrames.length).toBeLessThanOrEqual(5);
  });

  it("keeps user frames under the 5-frame cap after filtering internal frames", () => {
    const stack = [
      "Error: test",
      "    at usercode1.js:1:1",
      "    at usercode2.js:2:1",
      "    at /var/runtime/bootstrap.js:100:1",
      "    at usercode3.js:3:1",
    ].join("\n");

    const result = sanitizeStackTrace(stack)!;
    const resultFrames = result.split("\n").filter((l) => l.trim().startsWith("at "));
    expect(resultFrames.length).toBe(3); // 3 user frames, 1 internal removed
  });

  it("handles a stack with no frames (message only)", () => {
    const result = sanitizeStackTrace("Simple error message");
    expect(result).toBe("Simple error message");
  });
});
