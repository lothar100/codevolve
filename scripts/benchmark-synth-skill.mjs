import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { decode } from "@toon-format/toon";
import { transform } from "sucrase";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const API_URL = process.env.CODEVOLVE_API_URL ?? "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const REGION = "us-east-2";
const REPO_DIR = process.cwd();
const PROBLEM_ID = "75b1b5ee-43da-4542-ad9a-3def57b50bc3";
const RUNS = Number.parseInt(process.env.BENCHMARK_RUNS ?? "3", 10);
const ACCEPT_HEADER = process.env.BENCHMARK_ACCEPT ?? "text/toon, application/json;q=0.8";
const SKILL_ID = randomUUID();
const SKILL_NAME = `build-frontend-and-cdk-synth-benchmark-${Date.now()}`;
const AGENT_PROMPT =
  "Run `npm run build` in the `frontend` directory, then run `npx cdk synth CodevolveStack --context region=us-east-2` from the repo root. Return whether both commands succeeded.";
const SKILL_INPUTS = {
  projectDir: REPO_DIR,
  stackName: "CodevolveStack",
  region: REGION,
  frontendDir: "frontend",
};

const implementation = `
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

function runCommand(command: string, args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || \`\${command} failed\`).trim());
  }

  return {
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status ?? 0,
  };
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\\r?\\n/).length;
}

export async function handler(inputs: {
  projectDir: string;
  stackName?: string;
  region?: string;
  frontendDir?: string;
  extraArgs?: string[];
}): Promise<unknown> {
  const stackName = inputs.stackName ?? "CodevolveStack";
  const region = inputs.region ?? "us-east-2";
  const frontendDir = inputs.frontendDir ?? "frontend";
  const frontendPath = join(inputs.projectDir, frontendDir);
  const synthOutputDir = join(inputs.projectDir, \`.cdk-benchmark-\${Date.now()}-\${Math.random().toString(36).slice(2)}\`);

  let buildSummary: { stdout_lines: number; stderr_lines: number } | null = null;
  if (existsSync(frontendPath)) {
    const build = runCommand("npm", ["run", "build"], frontendPath);
    buildSummary = {
      stdout_lines: lineCount(build.stdout),
      stderr_lines: lineCount(build.stderr),
    };
  }

  const args = ["cdk", "synth", stackName, "--output", synthOutputDir, "--context", \`region=\${region}\`];
  if (Array.isArray(inputs.extraArgs)) {
    args.push(...inputs.extraArgs);
  }

  const synth = runCommand("npx", args, inputs.projectDir);

  return {
    stack_name: stackName,
    region,
    build_ran: buildSummary !== null,
    build_stdout_lines: buildSummary?.stdout_lines ?? 0,
    build_stderr_lines: buildSummary?.stderr_lines ?? 0,
    synth_succeeded: true,
    synth_stdout_lines: lineCount(synth.stdout),
    synth_stderr_lines: lineCount(synth.stderr),
    synth_stdout_chars: synth.stdout.length,
    synth_stderr_chars: synth.stderr.length,
    synth_output_dir: synthOutputDir,
  };
}
`.trim();

function estimateTokens(value) {
  return Math.ceil(String(value).length / 4);
}

function commandFor(base) {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function runCommand(command, args, cwd) {
  const started = performance.now();
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", commandFor(command), ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawnSync(commandFor(command), args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
  const ended = performance.now();

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }

  return {
    ms: ended - started,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    status: result.status ?? 0,
  };
}

async function fetchJsonWithTiming(method, url, body) {
  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers: {
      Accept: ACCEPT_HEADER,
      "Content-Type": "application/json",
      "X-Agent-Id": "codex-benchmark",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const ended = performance.now();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  let parsed = text;
  try {
    parsed = contentType.includes("text/toon") || contentType.includes("application/toon")
      ? decode(text)
      : JSON.parse(text);
  } catch {}

  return {
    status: response.status,
    ms: ended - started,
    requestText: body === undefined ? "" : JSON.stringify(body),
    responseText: text,
    json: parsed,
  };
}

async function runFetchedImplementation(sourceText, inputs) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codevolve-skill-"));
  const sourcePath = path.join(tempDir, "skill.ts");
  const outputPath = path.join(tempDir, "skill.mjs");

  try {
    writeFileSync(sourcePath, sourceText, "utf8");
    const transpiled = transform(sourceText, {
      transforms: ["typescript"],
      production: true,
    }).code;
    writeFileSync(outputPath, transpiled, "utf8");

    const moduleUrl = `${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`;
    const mod = await import(moduleUrl);
    if (typeof mod.handler !== "function") {
      throw new Error("Fetched skill did not export handler()");
    }

    const started = performance.now();
    const result = await mod.handler(inputs);
    const ended = performance.now();
    if (result && typeof result === "object" && typeof result.synth_output_dir === "string") {
      rmSync(result.synth_output_dir, { recursive: true, force: true });
    }
    return {
      ms: ended - started,
      result,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function seedSkill() {
  const now = new Date().toISOString();
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

  await doc.send(
    new PutCommand({
      TableName: "codevolve-skills",
      Item: {
        skill_id: SKILL_ID,
        version_number: 1,
        problem_id: PROBLEM_ID,
        name: SKILL_NAME,
        description:
          "Build the codeVolve frontend locally and run CDK synth for the target stack using Windows-safe npm and npx command resolution. Use for local benchmark or pre-deploy verification without deploying infrastructure, and return a compact summary instead of the full synth output.",
        version_label: "0.1.0",
        is_canonical: false,
        status: "partial",
        language: "typescript",
        domain: ["aws", "infrastructure", "frontend"],
        tags: ["benchmark", "cdk", "synth", "frontend", "build", "local-run", "windows"],
        inputs: [
          { name: "projectDir", type: "string" },
          { name: "stackName", type: "string?" },
          { name: "region", type: "string?" },
          { name: "frontendDir", type: "string?" },
          { name: "extraArgs", type: "string[]?" },
        ],
        outputs: [{ name: "result", type: "object" }],
        examples: [
          {
            input: {
              projectDir: "/workspace/codevolve",
              stackName: "CodevolveStack",
              region: "us-east-2",
              frontendDir: "frontend",
            },
            output: {
              stack_name: "CodevolveStack",
              region: "us-east-2",
              build_ran: true,
              synth_succeeded: true,
            },
          },
        ],
        tests: [
          {
            input: { projectDir: "/workspace/codevolve" },
            expected: {
              stack_name: "CodevolveStack",
              build_ran: true,
              synth_succeeded: true,
            },
          },
          {
            input: {
              projectDir: "/workspace/codevolve",
              frontendDir: "frontend",
              region: "us-east-2",
            },
            expected: {
              region: "us-east-2",
              synth_succeeded: true,
            },
          },
        ],
        implementation,
        confidence: 0,
        implementation_token_size: estimateTokens(implementation),
        latency_p50_ms: null,
        latency_p95_ms: null,
        execution_count: 0,
        last_executed_at: null,
        optimization_flagged: false,
        created_at: now,
        updated_at: now,
      },
    }),
  );

  await doc.send(
    new UpdateCommand({
      TableName: "codevolve-problems",
      Key: { problem_id: PROBLEM_ID },
      UpdateExpression:
        "SET skill_count = if_not_exists(skill_count, :zero) + :one, updated_at = :now",
      ExpressionAttributeValues: {
        ":zero": 0,
        ":one": 1,
        ":now": now,
      },
    }),
  );

  return {
    skill_id: SKILL_ID,
    name: SKILL_NAME,
    implementation_token_size: estimateTokens(implementation),
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

async function benchmarkSkillPath(skillId) {
  const runs = [];

  for (let i = 0; i < RUNS; i += 1) {
    const getSkill = await fetchJsonWithTiming("GET", `${API_URL}/skills/${skillId}`);
    if (getSkill.status !== 200) {
      throw new Error(`GET /skills/${skillId} failed: ${getSkill.status} ${getSkill.responseText}`);
    }

    const execution = await runFetchedImplementation(getSkill.json.skill.implementation, SKILL_INPUTS);
    const feedback = await fetchJsonWithTiming("POST", `${API_URL}/feedback`, {
      skill_id: skillId,
      inputs: SKILL_INPUTS,
      latency_ms: execution.ms,
      cache_hit: false,
      success: true,
    });

    runs.push({
      get_skill_ms: getSkill.ms,
      execute_ms: execution.ms,
      feedback_ms: feedback.ms,
      total_ms: getSkill.ms + execution.ms + feedback.ms,
      request_tokens_est:
        estimateTokens(`GET /skills/${skillId}`) + estimateTokens(feedback.requestText),
      response_tokens_est:
        estimateTokens(getSkill.responseText) +
        estimateTokens(JSON.stringify(execution.result)) +
        estimateTokens(feedback.responseText),
      result: execution.result,
    });
  }

  return {
    runs,
    totals_ms: summarize(runs.map((run) => run.total_ms)),
    execute_ms: summarize(runs.map((run) => run.execute_ms)),
    request_tokens_est: summarize(runs.map((run) => run.request_tokens_est)),
    response_tokens_est: summarize(runs.map((run) => run.response_tokens_est)),
  };
}

function benchmarkCommandPath() {
  const runs = [];

  for (let i = 0; i < RUNS; i += 1) {
    const build = runCommand("npm", ["run", "build"], path.join(REPO_DIR, "frontend"));
    const synthOutputDir = path.join(REPO_DIR, `.cdk-benchmark-${Date.now()}-${i}`);
    const synth = runCommand(
      "npx",
      [
        "cdk",
        "synth",
        "CodevolveStack",
        "--output",
        synthOutputDir,
        "--context",
        `region=${REGION}`,
      ],
      REPO_DIR,
    );
    rmSync(synthOutputDir, { recursive: true, force: true });

    runs.push({
      build_ms: build.ms,
      synth_ms: synth.ms,
      total_ms: build.ms + synth.ms,
      prompt_tokens_est: estimateTokens(AGENT_PROMPT),
      shell_output_tokens_est: estimateTokens(build.stdout) + estimateTokens(build.stderr) + estimateTokens(synth.stdout) + estimateTokens(synth.stderr),
      build_stdout_chars: build.stdout.length,
      build_stderr_chars: build.stderr.length,
      synth_stdout_chars: synth.stdout.length,
      synth_stderr_chars: synth.stderr.length,
    });
  }

  return {
    runs,
    totals_ms: summarize(runs.map((run) => run.total_ms)),
    synth_ms: summarize(runs.map((run) => run.synth_ms)),
    prompt_tokens_est: summarize(runs.map((run) => run.prompt_tokens_est)),
    shell_output_tokens_est: summarize(runs.map((run) => run.shell_output_tokens_est)),
  };
}

async function main() {
  const seeded = await seedSkill();
  const skill = await benchmarkSkillPath(seeded.skill_id);
  const agent = benchmarkCommandPath();

  console.log(
    JSON.stringify(
      {
        benchmark: {
          runs: RUNS,
          repo_dir: REPO_DIR,
          api_url: API_URL,
          accept_header: ACCEPT_HEADER,
        },
        seeded_skill: seeded,
        skill_path: skill,
        direct_command_path: agent,
      },
      null,
      2,
    ),
  );
}

await main();
