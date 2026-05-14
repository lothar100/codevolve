import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

import { transform } from "sucrase";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const API_URL = process.env.CODEVOLVE_API_URL ?? "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const SKILL_INTENT = "deploy codevolve dashboard with cdk";
const KNOWN_SKILL_ID = "d1ae17d1-4778-4beb-a0fc-3bcfacab4397";
const REPO_DIR = process.cwd();
const SKILL_INPUTS = {
  projectDir: REPO_DIR,
  stackName: "CodevolveStack",
  region: "us-east-2",
  frontendDir: "frontend",
  requireApproval: "never",
};

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
  };
}

async function fetchJsonWithTiming(method, url, body) {
  const started = performance.now();
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": "codex-benchmark",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const ended = performance.now();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
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
    const normalizedSource = sourceText
      .split("\n")
      .filter((line, index, lines) => {
        if (!line.startsWith("import ")) {
          return true;
        }
        return lines.indexOf(line) === index;
      })
      .join("\n");

    writeFileSync(sourcePath, normalizedSource, "utf8");
    const transpiled = transform(normalizedSource, {
      transforms: ["typescript"],
      production: true,
    }).code;
    writeFileSync(outputPath, transpiled, "utf8");

    const moduleUrl = pathToFileURL(outputPath).href;
    const mod = await import(moduleUrl);
    if (typeof mod.handler !== "function") {
      throw new Error("Fetched skill did not export handler()");
    }

    const started = performance.now();
    try {
      const result = await mod.handler(inputs);
      const ended = performance.now();
      return {
        ok: true,
        ms: ended - started,
        result,
      };
    } catch (error) {
      const ended = performance.now();
      return {
        ok: false,
        ms: ended - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function benchmarkApiFirstTime() {
  const intent = await fetchJsonWithTiming("POST", `${API_URL}/intent`, {
    intent: SKILL_INTENT,
    language: "typescript",
  });
  if (intent.status !== 200) {
    throw new Error(`API /intent failed: ${intent.status} ${intent.responseText}`);
  }

  const skillId = intent.json?.best_match?.skill_id;
  if (!skillId) {
    throw new Error(`API /intent did not return best_match: ${intent.responseText}`);
  }

  const getSkill = await fetchJsonWithTiming("GET", `${API_URL}/skills/${skillId}`);
  if (getSkill.status !== 200) {
    throw new Error(`API /skills failed: ${getSkill.status} ${getSkill.responseText}`);
  }

  const execution = await runFetchedImplementation(getSkill.json.skill.implementation, SKILL_INPUTS);

  return {
    skill_id: skillId,
    intent_ms: intent.ms,
    get_skill_ms: getSkill.ms,
    execute_ms: execution.ms,
    execute_ok: execution.ok,
    execute_error: execution.ok ? null : execution.error,
    total_ms: intent.ms + getSkill.ms + execution.ms,
    request_tokens_est: estimateTokens(intent.requestText) + estimateTokens(`GET /skills/${skillId}`),
    response_tokens_est: estimateTokens(intent.responseText) + estimateTokens(getSkill.responseText),
  };
}

async function benchmarkMcpKnownSkill() {
  const client = new Client({
    name: "codex-benchmark-client",
    version: "0.1.0",
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["packages/mcp-server/dist/index.js"],
    cwd: REPO_DIR,
    env: {
      CODEVOLVE_API_URL: API_URL,
      CODEVOLVE_AGENT_ID: "codex-benchmark-mcp",
    },
    stderr: "pipe",
  });

  const connectStarted = performance.now();
  await client.connect(transport);
  const connectEnded = performance.now();

  try {
    const requestEnvelope = JSON.stringify({
      method: "tools/call",
      params: {
        name: "get_skill",
        arguments: {
          skill_id: KNOWN_SKILL_ID,
        },
      },
    });

    const callStarted = performance.now();
    const toolResult = await client.callTool({
      name: "get_skill",
      arguments: {
        skill_id: KNOWN_SKILL_ID,
      },
    });
    const callEnded = performance.now();

    const toolText = toolResult.content?.[0]?.text;
    if (!toolText) {
      throw new Error("MCP get_skill returned no text content");
    }

    const parsed = JSON.parse(toolText);
    const execution = await runFetchedImplementation(parsed.skill.implementation, SKILL_INPUTS);

    return {
      skill_id: KNOWN_SKILL_ID,
      connect_ms: connectEnded - connectStarted,
      get_skill_ms: callEnded - callStarted,
      execute_ms: execution.ms,
      execute_ok: execution.ok,
      execute_error: execution.ok ? null : execution.error,
      total_ms_steady_state: (callEnded - callStarted) + execution.ms,
      request_tokens_est: estimateTokens(requestEnvelope),
      response_tokens_est: estimateTokens(JSON.stringify(toolResult)),
    };
  } finally {
    await client.close();
  }
}

function benchmarkAgentPath() {
  const build = runCommand("npm", ["run", "build"], path.join(REPO_DIR, "frontend"));
  const deploy = runCommand(
    "npx",
    [
      "cdk",
      "deploy",
      "CodevolveStack",
      "--require-approval",
      "never",
      "--outputs-file",
      "cdk-outputs.json",
      "--context",
      "region=us-east-2",
    ],
    REPO_DIR,
  );

  return {
    build_ms: build.ms,
    deploy_ms: deploy.ms,
    total_ms: build.ms + deploy.ms,
  };
}

async function main() {
  const api = await benchmarkApiFirstTime();
  const mcp = await benchmarkMcpKnownSkill();
  const agent = benchmarkAgentPath();

  console.log(JSON.stringify({ api, mcp, agent }, null, 2));
}

await main();
