/**
 * SQS-triggered Lambda handler for the /evolve pipeline.
 *
 * Each SQS message originates from the Decision Engine gap-detection rule and
 * represents an intent that failed to resolve with sufficient confidence. For
 * every message the handler:
 *
 *   1. Parses and validates the SQS body against GapQueueMessageSchema.
 *   2. Writes an evolve-job record to DynamoDB with status "running".
 *   3. Queries similar skills from DynamoDB (by domain / language tags) to
 *      pass as few-shot examples to the prompt.
 *   4. Builds the prompt via skillPrompt.buildSkillPrompt.
 *   5. Calls the Claude API (claude-sonnet-4-6) with the prompt.
 *   6. Parses the response with skillParser, validates the parsed object
 *      against CreateSkillRequestSchema (Zod).
 *   7. Writes the new skill to DynamoDB via PutItem.
 *   8. Invokes the validation Lambda asynchronously (fire-and-forget).
 *   9. Updates the evolve-job to status "complete" with the new skill_id.
 *  10. Returns { batchItemFailures: [] } on success.
 *
 * Error classification:
 *   - Permanent errors (JSON parse failure, Zod schema validation) →
 *     update job to "failed", consume the message (no retry).
 *   - Transient errors (DynamoDB throttle, Lambda invoke transient) →
 *     return batchItemFailures with record itemIdentifier (forces SQS retry).
 *
 * Architecture constraint: this Lambda is the ONLY place that calls the
 * Claude API. All other hot-path handlers must not contain LLM calls.
 */

import type {
  SQSEvent,
  SQSBatchResponse,
  SQSBatchItemFailure,
} from "aws-lambda";
import { z } from "zod";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  docClient,
  SKILLS_TABLE,
  EVOLVE_JOBS_TABLE,
} from "../shared/dynamo.js";
import { emitEvent } from "../shared/emitEvent.js";
import { validate, CreateSkillRequestSchema } from "../shared/validation.js";
import { getAnthropicClient } from "./claudeClient.js";
import { buildSkillPrompt, type SimilarSkill } from "./skillPrompt.js";
import {
  parseClaudeSkillResponse,
  repairTestCases,
} from "./skillParser.js";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALIDATE_LAMBDA_NAME =
  process.env.VALIDATE_LAMBDA_NAME ?? "codevolve-validation-handler";

/** Maximum number of similar skills to pull for the prompt. */
const MAX_SIMILAR_SKILLS = 3;

/** TTL for evolve-job records: 30 days from creation. */
const JOB_TTL_SECONDS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Lambda client singleton
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

// ---------------------------------------------------------------------------
// GapQueueMessage schema — matches the message shape sent by the Decision Engine
// ---------------------------------------------------------------------------

/**
 * Shape of SQS messages sent to codevolve-gap-queue.fifo by the Decision
 * Engine gap-detection rule.
 *
 * See docs/decision-engine.md §5.1 for the authoritative schema.
 */
export const GapQueueMessageSchema = z.object({
  /** The original intent string that failed to resolve. */
  intent: z.string().min(1).max(1024),
  /** Confidence score from the failed resolve attempt (0–1). */
  resolve_confidence: z.number().min(0).max(1),
  /** ISO 8601 timestamp when the gap was detected. */
  timestamp: z.string().datetime(),
  /** SHA-256 hex of the normalized intent; used as stable dedup reference. */
  original_event_id: z.string().min(1),
});

export type GapQueueMessage = z.infer<typeof GapQueueMessageSchema>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when Claude's response cannot be parsed into a valid JSON object or
 * the parsed object fails Zod schema validation. These are permanent errors —
 * retrying the same message will produce the same bad output, so the message
 * should be consumed without retry.
 */
export class EvolveParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolveParseError";
  }
}

/** @internal alias kept for handler-internal usage */
class PermanentEvolveError extends EvolveParseError {}

// ---------------------------------------------------------------------------
// generateSkill — extracted for unit testing
// ---------------------------------------------------------------------------

/**
 * Call the Claude API with a skill-generation prompt and return the parsed
 * JSON object from the response.
 *
 * @param intent  The intent string to generate a skill for.
 * @param client  An Anthropic client instance (injected for testing).
 * @returns Parsed JSON object extracted from Claude's code-fenced response.
 * @throws {EvolveParseError} if the response cannot be parsed.
 */
export async function generateSkill(
  intent: string,
  client: Anthropic,
): Promise<unknown> {
  const similarSkills = await querySimilarSkills(intent);
  const prompt = buildSkillPrompt(intent, similarSkills);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    return parseClaudeSkillResponse(responseText);
  } catch (parseErr) {
    throw new EvolveParseError(
      `Failed to parse Claude response as JSON: ${(parseErr as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  // Resolve the Claude client once per cold start (lazy singleton).
  // We do this outside the per-record loop so Secrets Manager is called
  // at most once per container lifetime.
  let claudeClient: Anthropic;
  try {
    claudeClient = await getAnthropicClient();
  } catch (err) {
    // Secrets Manager is unavailable — every record in this batch is affected.
    // Return all records as failures so SQS retries the entire batch.
    console.error("[evolve] Failed to initialize Claude client:", err);
    for (const record of event.Records) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  }

  for (const record of event.Records) {
    const startMs = Date.now();
    let jobId: string | null = null;

    try {
      // -----------------------------------------------------------------
      // 1. Parse and validate SQS message body
      // -----------------------------------------------------------------
      let rawBody: unknown;
      try {
        rawBody = JSON.parse(record.body);
      } catch {
        throw new PermanentEvolveError(
          `SQS record body is not valid JSON: ${record.body.slice(0, 200)}`,
        );
      }

      const parsed = GapQueueMessageSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new PermanentEvolveError(
          `GapQueueMessage schema validation failed: ${JSON.stringify(parsed.error.issues)}`,
        );
      }

      const message: GapQueueMessage = parsed.data;
      console.log(`[evolve] Processing intent: "${message.intent}"`);

      // -----------------------------------------------------------------
      // 2. Write evolve-job with status "running"
      // -----------------------------------------------------------------
      jobId = uuidv4();
      const now = new Date().toISOString();
      const expiresAt = Math.floor(Date.now() / 1000) + JOB_TTL_SECONDS;

      await docClient.send(
        new PutCommand({
          TableName: EVOLVE_JOBS_TABLE,
          Item: {
            evolve_id: jobId,
            intent: message.intent,
            status: "running",
            skill_id: null,
            error: null,
            created_at: now,
            updated_at: now,
            expires_at: expiresAt,
          },
          ConditionExpression: "attribute_not_exists(evolve_id)",
        }),
      );

      // -----------------------------------------------------------------
      // 3. Query similar skills for prompt examples
      // -----------------------------------------------------------------
      const similarSkills = await querySimilarSkills(message.intent);

      // -----------------------------------------------------------------
      // 4. Build prompt
      // -----------------------------------------------------------------
      const prompt = buildSkillPrompt(message.intent, similarSkills);

      // -----------------------------------------------------------------
      // 5. Call Claude API (claude-sonnet-4-6)
      // -----------------------------------------------------------------
      const response = await claudeClient.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const responseText = response.content
        .filter(
          (block): block is Anthropic.TextBlock => block.type === "text",
        )
        .map((block) => block.text)
        .join("");

      // -----------------------------------------------------------------
      // 6. Parse and validate response
      // -----------------------------------------------------------------
      let rawSkill: unknown;
      try {
        rawSkill = parseClaudeSkillResponse(responseText);
      } catch (parseErr) {
        throw new PermanentEvolveError(
          `Failed to parse Claude response as JSON: ${(parseErr as Error).message}`,
        );
      }

      // Repair test cases before validation (output → expected)
      if (
        rawSkill !== null &&
        typeof rawSkill === "object" &&
        !Array.isArray(rawSkill)
      ) {
        const raw = rawSkill as Record<string, unknown>;
        if (Array.isArray(raw.tests)) {
          raw.tests = repairTestCases(raw.tests);
        }
      }

      const skillValidation = validate(CreateSkillRequestSchema, rawSkill);
      if (!skillValidation.success) {
        throw new PermanentEvolveError(
          `Generated skill failed schema validation: ${JSON.stringify(skillValidation.error.details)}`,
        );
      }

      const skillData = skillValidation.data;

      // -----------------------------------------------------------------
      // 7. Write new skill to DynamoDB
      // -----------------------------------------------------------------
      const skillId = uuidv4();
      const skillNow = new Date().toISOString();

      const skillItem: Record<string, unknown> = {
        skill_id: skillId,
        version_number: 1,
        version_label: skillData.version_label ?? "0.1.0",
        problem_id: skillData.problem_id,
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
        created_at: skillNow,
        updated_at: skillNow,
      };

      await docClient.send(
        new PutCommand({
          TableName: SKILLS_TABLE,
          Item: skillItem,
          ConditionExpression:
            "attribute_not_exists(skill_id) AND attribute_not_exists(version_number)",
        }),
      );

      console.log(`[evolve] Created skill ${skillId} for intent "${message.intent}"`);

      // -----------------------------------------------------------------
      // 8. Invoke validation Lambda asynchronously (fire-and-forget)
      // -----------------------------------------------------------------
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

      // -----------------------------------------------------------------
      // 9. Update evolve-job to "complete"
      // -----------------------------------------------------------------
      const completeNow = new Date().toISOString();
      await docClient.send(
        new UpdateCommand({
          TableName: EVOLVE_JOBS_TABLE,
          Key: { evolve_id: jobId },
          UpdateExpression:
            "SET #status = :status, skill_id = :skillId, updated_at = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": "complete",
            ":skillId": skillId,
            ":now": completeNow,
          },
        }),
      );

      // -----------------------------------------------------------------
      // Emit success Kinesis event (fire-and-forget)
      // -----------------------------------------------------------------
      await emitEvent({
        event_type: "validate",
        skill_id: skillId,
        intent: message.intent,
        latency_ms: Date.now() - startMs,
        confidence: 0,
        cache_hit: false,
        input_hash: null,
        success: true,
      });
    } catch (err) {
      if (err instanceof PermanentEvolveError) {
        // -----------------------------------------------------------------
        // 11. Permanent error — consume the message, update job to "failed"
        // -----------------------------------------------------------------
        console.error(
          `[evolve] Permanent error for message ${record.messageId}:`,
          err.message,
        );

        if (jobId !== null) {
          try {
            const failedNow = new Date().toISOString();
            await docClient.send(
              new UpdateCommand({
                TableName: EVOLVE_JOBS_TABLE,
                Key: { evolve_id: jobId },
                UpdateExpression:
                  "SET #status = :status, #error = :error, updated_at = :now",
                ExpressionAttributeNames: {
                  "#status": "status",
                  "#error": "error",
                },
                ExpressionAttributeValues: {
                  ":status": "failed",
                  ":error": err.message,
                  ":now": failedNow,
                },
              }),
            );
          } catch (updateErr) {
            console.error(
              `[evolve] Failed to update job ${jobId} to failed status:`,
              updateErr,
            );
          }
        }

        await emitEvent({
          event_type: "fail",
          skill_id: null,
          intent: `evolve_failed:${record.body.slice(0, 256)}`,
          latency_ms: Date.now() - startMs,
          confidence: null,
          cache_hit: false,
          input_hash: null,
          success: false,
        });

        // Do NOT push to batchItemFailures — message is consumed.
      } else {
        // -----------------------------------------------------------------
        // 12. Transient error — return in batchItemFailures to force retry
        // -----------------------------------------------------------------
        console.error(
          `[evolve] Transient error for message ${record.messageId}:`,
          err,
        );
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  }

  // 10. Return result — SQS partial batch failure response
  return { batchItemFailures };
};

// ---------------------------------------------------------------------------
// querySimilarSkills
// ---------------------------------------------------------------------------

/**
 * Query up to MAX_SIMILAR_SKILLS skills from DynamoDB to use as few-shot
 * examples in the prompt.
 *
 * Strategy: scan the GSI-language-confidence index filtered to "python"
 * (the most common language in the registry) and return the top N by
 * confidence. This is a best-effort heuristic — if the query fails the
 * handler continues with an empty examples array.
 *
 * In a future iteration this should be replaced with embedding-based
 * similarity search against the intent string (Phase 5).
 */
async function querySimilarSkills(intent: string): Promise<SimilarSkill[]> {
  try {
    // Use the language/confidence GSI to get high-confidence skills as examples.
    // We pass the intent to log context but don't use it for filtering yet.
    void intent;

    const result = await docClient.send(
      new QueryCommand({
        TableName: SKILLS_TABLE,
        IndexName: "GSI-language-confidence",
        KeyConditionExpression: "language = :lang",
        FilterExpression: "#status <> :archived",
        ExpressionAttributeNames: {
          "#status": "status",
          "#n": "name",
        },
        ExpressionAttributeValues: {
          ":lang": "python",
          ":archived": "archived",
        },
        ScanIndexForward: false, // highest confidence first
        Limit: MAX_SIMILAR_SKILLS,
        ProjectionExpression:
          "skill_id, #n, description, language, domain, tags, inputs, outputs",
      }),
    );

    const items = result.Items ?? [];
    return items.map((item) => ({
      skill_id: item.skill_id as string,
      name: item.name as string,
      description: item.description as string,
      language: item.language as string,
      domain: (item.domain as string[]) ?? [],
      tags: (item.tags as string[]) ?? [],
      inputs: (item.inputs as Array<{ name: string; type: string }>) ?? [],
      outputs: (item.outputs as Array<{ name: string; type: string }>) ?? [],
    }));
  } catch (err) {
    console.warn("[evolve] querySimilarSkills failed (continuing without examples):", err);
    return [];
  }
}
