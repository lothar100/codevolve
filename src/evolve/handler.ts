/**
 * SQS-triggered Lambda handler for the /evolve pipeline.
 *
 * Each SQS message represents an unresolved intent (a gap detected by the
 * Decision Engine).  For every message the handler:
 *   1. Calls Claude to generate a candidate skill JSON.
 *   2. Validates the JSON against CreateSkillRequestSchema (Zod).
 *   3. Writes the new skill to DynamoDB.
 *   4. Invokes the validation Lambda asynchronously to run tests and score it.
 *   5. Emits an "evolve" Kinesis event on success, or "evolve_failed" on a
 *      non-retryable error.
 *
 * Error classification (controls SQS / DLQ routing):
 *   - Anthropic rate limit (429) / network errors  → throw  → SQS retries
 *   - JSON parse failure                            → consume (no retry), emit evolve_failed
 *   - Zod validation failure                        → consume (no retry), emit evolve_failed
 *
 * Architecture constraint: this is the ONLY Lambda that calls the Claude API.
 */

import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import Anthropic from "@anthropic-ai/sdk";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  LambdaClient,
  InvokeCommand,
} from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { emitEvent } from "../shared/emitEvent.js";
import { validate, CreateSkillRequestSchema } from "../shared/validation.js";
import { getClaudeClient } from "./claudeClient.js";
import { buildSkillPrompt, type SimilarSkill } from "./skillPrompt.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALIDATE_LAMBDA_NAME =
  process.env.VALIDATE_LAMBDA_NAME ?? "codevolve-validation-handler";

// ---------------------------------------------------------------------------
// Lambda clients (module-level singletons — reused across warm invocations)
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// ---------------------------------------------------------------------------
// SQS message shape (sent by the Decision Engine gap-detection rule)
// ---------------------------------------------------------------------------

interface EvolveMessage {
  intent: string;
  /** Optional problem context to attach the generated skill to. */
  problem_id?: string;
  /** ISO-8601 timestamp when the gap was detected. */
  detected_at?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  // Resolve the Claude client once per cold start (cached singleton).
  // We do this outside the per-record loop so the Secrets Manager call
  // is made at most once per container lifetime.
  const claudeClient = await getClaudeClient();

  for (const record of event.Records) {
    try {
      const message: EvolveMessage = JSON.parse(record.body);
      await processEvolveMessage(message, claudeClient);
    } catch (err) {
      // Retryable errors (network, rate-limit, DynamoDB transient) reach here.
      // Returning the messageId in batchItemFailures lets SQS retry the
      // individual message; after maxReceiveCount it moves to the DLQ.
      console.error(
        `[evolve] Retryable error processing message ${record.messageId}:`,
        err,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

// ---------------------------------------------------------------------------
// Core processing
// ---------------------------------------------------------------------------

async function processEvolveMessage(
  message: EvolveMessage,
  claudeClient: Anthropic,
): Promise<void> {
  const { intent, problem_id: problemId } = message;
  const startMs = Date.now();

  console.log(`[evolve] Processing intent: "${intent}"`);

  // -------------------------------------------------------------------------
  // 1. Call Claude to generate a skill
  // -------------------------------------------------------------------------
  let rawSkill: unknown;
  try {
    rawSkill = await generateSkill(intent, claudeClient);
  } catch (err) {
    // Distinguish non-retryable parse failures from retryable API errors.
    if (err instanceof EvolveParseError) {
      // JSON was missing or malformed — no point retrying; consume the message.
      console.error(`[evolve] Non-retryable parse error for intent "${intent}":`, err.message);
      await emitEvolvedFailedEvent(intent, Date.now() - startMs);
      return; // Do NOT rethrow — message is consumed.
    }
    // Any other error (rate limit, network, etc.) is retryable — rethrow.
    throw err;
  }

  // -------------------------------------------------------------------------
  // 2. Validate generated skill against CreateSkillRequestSchema
  // -------------------------------------------------------------------------
  const skillValidation = validate(CreateSkillRequestSchema, rawSkill);
  if (!skillValidation.success) {
    console.error(
      `[evolve] Schema validation failed for intent "${intent}":`,
      JSON.stringify(skillValidation.error.details),
    );
    await emitEvolvedFailedEvent(intent, Date.now() - startMs);
    return; // Consume — retrying will produce the same invalid output.
  }

  const skillData = skillValidation.data;

  // -------------------------------------------------------------------------
  // 3. Write to DynamoDB
  // -------------------------------------------------------------------------
  const now = new Date().toISOString();
  const skillId = uuidv4();

  const skillItem: Record<string, unknown> = {
    skill_id: skillId,
    version_number: 1,
    version_label: skillData.version_label ?? "0.1.0",
    problem_id: problemId ?? skillData.problem_id,
    name: skillData.name,
    description: skillData.description,
    is_canonical: false,
    status: "partial",
    language: skillData.language,
    domain: skillData.domain,
    tags: skillData.tags ?? [],
    inputs: skillData.inputs,
    outputs: skillData.outputs,
    examples: skillData.examples ?? [],
    tests: skillData.tests ?? [],
    implementation: skillData.implementation ?? "",
    confidence: 0,
    latency_p50_ms: null,
    latency_p95_ms: null,
    execution_count: 0,
    last_executed_at: null,
    optimization_flagged: false,
    created_at: now,
    updated_at: now,
  };

  // DynamoDB write errors are retryable — let them propagate.
  await docClient.send(
    new PutCommand({
      TableName: SKILLS_TABLE,
      Item: skillItem,
      ConditionExpression:
        "attribute_not_exists(skill_id) AND attribute_not_exists(version_number)",
    }),
  );

  console.log(`[evolve] Created skill ${skillId} for intent "${intent}"`);

  // -------------------------------------------------------------------------
  // 4. Invoke validation Lambda asynchronously (Event — fire-and-forget)
  // -------------------------------------------------------------------------
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: VALIDATE_LAMBDA_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({ pathParameters: { skill_id: skillId } }),
        ),
      }),
    );
    console.log(`[evolve] Validation Lambda invoked for skill ${skillId}`);
  } catch (invokeErr) {
    // Non-fatal: skill is written; validation can be triggered manually.
    console.error(
      `[evolve] Failed to invoke validation Lambda for skill ${skillId}:`,
      invokeErr,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Emit success Kinesis event (fire-and-forget — never crashes the handler)
  // -------------------------------------------------------------------------
  await emitEvent({
    event_type: "validate", // closest existing event_type for "skill created via evolve"
    skill_id: skillId,
    intent,
    latency_ms: Date.now() - startMs,
    confidence: 0,
    cache_hit: false,
    input_hash: null,
    success: true,
  });
}

// ---------------------------------------------------------------------------
// generateSkill — calls Claude, extracts JSON from code fence
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when Claude's response does not contain a valid JSON
 * code fence.  Callers must treat this as non-retryable.
 */
export class EvolveParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolveParseError";
  }
}

/**
 * Call Claude to generate a skill object for the given intent.
 *
 * @param intent       The unresolved intent string.
 * @param claudeClient Injected client — enables unit test mocking.
 * @returns            Parsed JSON object (not yet Zod-validated).
 * @throws             EvolveParseError if the response has no JSON code fence.
 * @throws             Anthropic SDK error on rate limit / network failure (retryable).
 */
export async function generateSkill(
  intent: string,
  claudeClient: Anthropic,
): Promise<unknown> {
  // Phase 5: wire similarSkills to /resolve embedding lookup.
  // For now, pass an empty array — the prompt still works without examples.
  const similarSkills: SimilarSkill[] = [];

  const prompt = buildSkillPrompt(intent, similarSkills);

  // claude-sonnet-4-6 is the mandated model (architecture constraint).
  const response = await claudeClient.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract all text blocks and join them.
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Locate the ```json … ``` code fence.
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    throw new EvolveParseError(
      "Claude response did not contain a JSON code fence",
    );
  }

  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    throw new EvolveParseError(
      `Claude response contained a JSON code fence but its content was not valid JSON: ${jsonMatch[1].slice(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function emitEvolvedFailedEvent(
  intent: string,
  latencyMs: number,
): Promise<void> {
  await emitEvent({
    event_type: "fail",
    skill_id: null,
    intent: `evolve_failed:${intent}`,
    latency_ms: latencyMs,
    confidence: null,
    cache_hit: false,
    input_hash: null,
    success: false,
  });
}
