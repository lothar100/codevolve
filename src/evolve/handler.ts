/**
 * SQS-triggered Lambda handler for the /evolve pipeline.
 *
 * Trigger: codevolve-gap-queue.fifo
 *
 * Flow:
 *   1. Parse and validate the SQS message body (JSON + zod).
 *   2. Call generateSkill(intent) — stubbed until ARCH-08.
 *   3. Validate the generated skill against SkillSchema (zod).
 *      On failure: emit evolve_failed → Kinesis, throw (→ DLQ after 3 attempts).
 *   4. Write the new skill to DynamoDB (codevolve-skills table).
 *   5. Emit event_type: "evolve" to Kinesis.
 *   6. Invoke codevolve-validate Lambda async (fire-and-forget).
 *
 * Partial batch failure: ReportBatchItemFailures — failed messageIds returned
 * in batchItemFailures.
 */

import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { docClient, SKILLS_TABLE } from "../shared/dynamo.js";
import { emitEvent } from "../shared/emitEvent.js";
import { SkillSchema } from "../shared/validation.js";

// ---------------------------------------------------------------------------
// Lambda client (used for fire-and-forget validate invocation)
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const VALIDATE_FUNCTION_NAME =
  process.env.VALIDATE_FUNCTION_NAME ?? "codevolve-validate";

// ---------------------------------------------------------------------------
// SQS message schema
// ---------------------------------------------------------------------------

const GapMessageSchema = z.object({
  intent: z.string().min(1).max(1024),
  resolve_confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  original_event_id: z.string().min(1),
});

type GapMessage = z.infer<typeof GapMessageSchema>;

// ---------------------------------------------------------------------------
// Claude stub
// ---------------------------------------------------------------------------

/**
 * TODO(IMPL-12): implement Claude API call once ARCH-08 prompt design is complete.
 *
 * Returns a skill-shaped object. The caller validates against SkillSchema
 * before writing to DynamoDB.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateSkill(_intent: string): Promise<unknown> {
  throw new Error(
    "Claude skill generation not yet implemented — ARCH-08 pending",
  );
}

// ---------------------------------------------------------------------------
// Core processing logic (one SQS record)
// ---------------------------------------------------------------------------

async function processGapMessage(message: GapMessage): Promise<string> {
  const { intent } = message;

  // Step 2: generate skill (stubbed — throws until ARCH-08)
  let rawSkill: unknown;
  try {
    rawSkill = await generateSkill(intent);
  } catch (err) {
    console.error("[evolve] generateSkill failed:", err);

    await emitEvent({
      event_type: "evolve_failed",
      skill_id: null,
      intent,
      latency_ms: 0,
      confidence: null,
      cache_hit: false,
      input_hash: null,
      success: false,
    });

    throw err;
  }

  // Step 3: validate generated skill against SkillSchema
  const parseResult = SkillSchema.safeParse(rawSkill);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    console.error("[evolve] Generated skill failed schema validation:", issues);

    await emitEvent({
      event_type: "evolve_failed",
      skill_id: null,
      intent,
      latency_ms: 0,
      confidence: null,
      cache_hit: false,
      input_hash: null,
      success: false,
    });

    throw new Error(`Generated skill failed schema validation: ${issues}`);
  }

  const skill = parseResult.data;
  const skillId = uuidv4();
  const now = new Date().toISOString();

  // Build the DynamoDB item (new skill, version 1, confidence 0, status partial)
  const skillItem: Record<string, unknown> = {
    skill_id: skillId,
    version_number: 1,
    version_label: skill.version_label ?? "0.1.0",
    problem_id: skill.problem_id,
    name: skill.name,
    description: skill.description,
    is_canonical: false,
    status: "partial" as const,
    language: skill.language,
    domain: skill.domain,
    tags: skill.tags,
    inputs: skill.inputs,
    outputs: skill.outputs,
    examples: skill.examples,
    tests: skill.tests,
    implementation: skill.implementation,
    confidence: 0,
    latency_p50_ms: null,
    latency_p95_ms: null,
    execution_count: 0,
    last_executed_at: null,
    optimization_flagged: false,
    created_at: now,
    updated_at: now,
  };

  // Step 4: write to DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: SKILLS_TABLE,
      Item: skillItem,
      ConditionExpression:
        "attribute_not_exists(skill_id) AND attribute_not_exists(version_number)",
    }),
  );

  console.log(
    `[evolve] Wrote new skill ${skillId} for intent: "${intent}"`,
  );

  // Step 5: emit evolve event (fire-and-forget)
  emitEvent({
    event_type: "evolve",
    skill_id: skillId,
    intent,
    latency_ms: 0,
    confidence: 0,
    cache_hit: false,
    input_hash: null,
    success: true,
  }).catch((e) =>
    console.warn("[evolve] emitEvent (evolve) failed (swallowed):", e),
  );

  // Step 6: invoke validate Lambda async (fire-and-forget)
  const validatePayload = JSON.stringify({ skill_id: skillId });

  lambdaClient
    .send(
      new InvokeCommand({
        FunctionName: VALIDATE_FUNCTION_NAME,
        InvocationType: InvocationType.Event, // async — fire-and-forget
        Payload: Buffer.from(validatePayload),
      }),
    )
    .catch((e) =>
      console.warn(
        "[evolve] validate Lambda invoke failed (swallowed):",
        e,
      ),
    );

  return skillId;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      // Step 1: parse and validate message body
      let body: unknown;
      try {
        body = JSON.parse(record.body);
      } catch {
        throw new Error(
          `Invalid JSON in SQS message body: ${record.messageId}`,
        );
      }

      const parseResult = GapMessageSchema.safeParse(body);
      if (!parseResult.success) {
        const issues = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid GapMessage: ${issues}`);
      }

      await processGapMessage(parseResult.data);
    } catch (err) {
      console.error(
        `[evolve] Failed to process message ${record.messageId}:`,
        err,
      );
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
