import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { validate } from "../shared/validation.js";
import { success, error } from "../shared/response.js";
import { emitEvent } from "../shared/emitEvent.js";
import {
  fetchSkillSummaryById,
  resolveIntentRequest,
  type ChainSuggestion,
  type IntentMatch,
} from "./intentCore.js";

const IntentChainStepSchema = z.object({
  intent: z.string().min(1).max(1000),
  language: z.string().optional(),
  domain: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  input_mapping: z.record(z.string()).optional().default({}),
});

const SkillChainStepSchema = z.object({
  skill_id: z.string().uuid(),
  input_mapping: z.record(z.string()).optional().default({}),
});

const ChainSuggestionSchema: z.ZodType<ChainSuggestion> = z.object({
  kind: z.literal("intent_chain"),
  rationale: z.string(),
  overall_confidence: z.number(),
  steps: z.array(
    z.object({
      step: z.number().int().positive(),
      intent: z.string(),
      confidence: z.number(),
      best_match: z.object({
        skill_id: z.string().uuid(),
        name: z.string(),
        description: z.string(),
        language: z.string(),
        status: z.string(),
        is_canonical: z.boolean(),
        confidence: z.number(),
        similarity_score: z.number(),
        implementation_token_size: z.number().nullable(),
        domain: z.array(z.string()),
        tags: z.array(z.string()),
      }).nullable(),
      input_mapping: z.record(z.string()),
    }),
  ).min(2).max(10),
});

const ChainRequestSchema = z.object({
  steps: z.array(z.union([IntentChainStepSchema, SkillChainStepSchema])).min(2).max(10).optional(),
  suggestion: ChainSuggestionSchema.optional(),
}).refine((value) => value.steps !== undefined || value.suggestion !== undefined, {
  message: "Provide either steps or suggestion",
  path: ["steps"],
});

interface ChainPlanStep {
  step: number;
  intent: string | null;
  input_mapping: Record<string, string>;
  best_match: IntentMatch | null;
  confidence: number;
  resolved: boolean;
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const startMs = Date.now();

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "VALIDATION_ERROR", "Invalid JSON in request body");
  }

  const validation = validate(ChainRequestSchema, body);
  if (!validation.success) {
    return error(400, validation.error.code, validation.error.message, validation.error.details);
  }

  const req = validation.data;
  const steps = req.suggestion?.steps ?? req.steps ?? [];
  const resolvedSteps: ChainPlanStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;
    const inputMapping = (step["input_mapping"] as Record<string, string> | undefined) ?? {};
    const suggestedMatch =
      step["best_match"] !== null && typeof step["best_match"] === "object"
        ? (step["best_match"] as Record<string, unknown>)
        : null;
    const skillId =
      typeof step["skill_id"] === "string"
        ? (step["skill_id"] as string)
        : typeof suggestedMatch?.["skill_id"] === "string"
          ? (suggestedMatch["skill_id"] as string)
          : undefined;

    if (skillId) {
      const bestMatch = await fetchSkillSummaryById(skillId);
      resolvedSteps.push({
        step: i + 1,
        intent: typeof step["intent"] === "string" ? step["intent"] as string : null,
        input_mapping: inputMapping,
        best_match: bestMatch,
        confidence: bestMatch?.confidence ?? 0,
        resolved: bestMatch !== null,
      });
      continue;
    }

    const stepIntent = String(step["intent"]);
    const resolution = await resolveIntentRequest({
      intent: stepIntent,
      language: typeof step["language"] === "string" ? step["language"] as string : undefined,
      domain: Array.isArray(step["domain"]) ? step["domain"] as string[] : undefined,
      tags: Array.isArray(step["tags"]) ? step["tags"] as string[] : undefined,
      top_k: 1,
    });

    resolvedSteps.push({
      step: i + 1,
      intent: stepIntent,
      input_mapping: inputMapping,
      best_match: resolution.bestMatch,
      confidence: resolution.intentConfidence,
      resolved: resolution.bestMatch !== null,
    });
  }

  const readyForLocalExecution = resolvedSteps.every((step) => step.resolved);
  const overallConfidence =
    resolvedSteps.reduce((sum, step) => sum + step.confidence, 0) / resolvedSteps.length;
  const chainId = randomUUID();
  const unresolvedSteps = resolvedSteps.filter((step) => !step.resolved).length;

  void emitEvent({
    event_type: "resolve",
    skill_id: resolvedSteps[resolvedSteps.length - 1]?.best_match?.skill_id ?? null,
    intent: `chain:${resolvedSteps.map((step) => step.intent ?? step.best_match?.skill_id ?? "unknown").join(" -> ")}`,
    latency_ms: Date.now() - startMs,
    confidence: overallConfidence,
    cache_hit: false,
    input_hash: chainId,
    success: readyForLocalExecution,
  }).catch((emitErr) =>
    console.warn("[chains] emitEvent failed (swallowed):", emitErr),
  );

  return success(200, {
    chain_id: chainId,
    source: req.suggestion ? "suggestion" : "explicit",
    rationale:
      req.suggestion?.rationale ??
      "Resolve each step locally, fetch the referenced skill implementations, and execute them in order.",
    overall_confidence: overallConfidence,
    ready_for_local_execution: readyForLocalExecution,
    unresolved_steps: unresolvedSteps,
    steps: resolvedSteps,
  });
}
