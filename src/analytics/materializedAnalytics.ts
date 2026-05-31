import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { AnalyticsEvent } from "../shared/types.js";
import { computeEventId } from "./eventId.js";
import { getAnalyticsDocClient } from "./projectorClient.js";

const ANALYTICS_BUCKETS_TABLE =
  process.env.ANALYTICS_BUCKETS_TABLE ?? "codevolve-analytics-buckets";
const ANALYTICS_INTENT_SUMMARIES_TABLE =
  process.env.ANALYTICS_INTENT_SUMMARIES_TABLE ??
  "codevolve-analytics-intent-summaries";
const ANALYTICS_RECENT_FEEDS_TABLE =
  process.env.ANALYTICS_RECENT_FEEDS_TABLE ??
  "codevolve-analytics-recent-feeds";
const ANALYTICS_INPUT_STATE_TABLE =
  process.env.ANALYTICS_INPUT_STATE_TABLE ?? "codevolve-analytics-input-state";
const ANALYTICS_DEDUP_TABLE =
  process.env.ANALYTICS_DEDUP_TABLE ?? "codevolve-analytics-dedup";

const DEDUP_TTL_DAYS = 14;
const RECENT_ISSUE_TTL_DAYS = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.7;
const HIGH_CONFIDENCE_THRESHOLD = 0.9;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LATENCY_BUCKET_SIZE_MS = 10;
const MAX_TRANSACTION_RETRIES = 3;

type ScopeType = "global" | "skill";
type Granularity = "minute" | "hour" | "day";

interface InputRepeatState {
  last_seen_at?: string;
}

type TransactItem = NonNullable<
  ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
>[number];

export interface ProjectEventResult {
  eventId: string;
  duplicate: boolean;
}

export async function projectAnalyticsEvent(
  event: AnalyticsEvent,
): Promise<ProjectEventResult> {
  const eventId = computeEventId(
    event.event_type,
    event.timestamp,
    event.skill_id,
    event.intent,
    event.input_hash,
  );

  for (let attempt = 0; attempt < MAX_TRANSACTION_RETRIES; attempt++) {
    const repeatState = await loadInputRepeatState(event);
    const repeatedWithinWindow = isRepeatedWithinWindow(event, repeatState);

    try {
      await getAnalyticsDocClient().send(
        new TransactWriteCommand({
          TransactItems: buildTransactionItems(
            event,
            eventId,
            repeatState,
            repeatedWithinWindow,
          ),
        }),
      );

      return { eventId, duplicate: false };
    } catch (error) {
      if (isDuplicateTransaction(error)) {
        return { eventId, duplicate: true };
      }

      if (isRetryableRepeatConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Analytics projector exceeded ${MAX_TRANSACTION_RETRIES} retries for event ${eventId}`,
  );
}

async function loadInputRepeatState(
  event: AnalyticsEvent,
): Promise<InputRepeatState | null> {
  if (!shouldTrackInputRepeat(event)) {
    return null;
  }

  const response = await getAnalyticsDocClient().send(
    new GetCommand({
      TableName: ANALYTICS_INPUT_STATE_TABLE,
      Key: inputRepeatKey(event.skill_id!, event.input_hash!),
      ConsistentRead: true,
    }),
  );

  return (response.Item as InputRepeatState | undefined) ?? null;
}

function buildTransactionItems(
  event: AnalyticsEvent,
  eventId: string,
  repeatState: InputRepeatState | null,
  repeatedWithinWindow: boolean,
): TransactItem[] {
  const items: TransactItem[] = [
    {
      Put: {
        TableName: ANALYTICS_DEDUP_TABLE,
        Item: {
          pk: `event#${eventId}`,
          sk: "dedup",
          event_id: eventId,
          event_type: event.event_type,
          timestamp: event.timestamp,
          ttl: ttlDaysFrom(event.timestamp, DEDUP_TTL_DAYS),
        },
        ConditionExpression: "attribute_not_exists(pk)",
      },
    },
  ];

  for (const granularity of ["minute", "hour"] as const) {
    items.push(
      buildBucketUpdate(
        event,
        granularity,
        "global",
        null,
        repeatedWithinWindow,
      ),
    );
  }

  if (event.skill_id !== null) {
    items.push(
      buildBucketUpdate(
        event,
        "hour",
        "skill",
        event.skill_id,
        repeatedWithinWindow,
      ),
    );
    items.push(
      buildBucketUpdate(
        event,
        "day",
        "skill",
        event.skill_id,
        repeatedWithinWindow,
      ),
    );
  }

  if (event.intent !== null) {
    items.push(buildIntentSummaryUpdate(event));
  }

  const recentIssuePut = buildRecentIssuePut(event, eventId);
  if (recentIssuePut !== null) {
    items.push(recentIssuePut);
  }

  if (shouldTrackInputRepeat(event)) {
    items.push(
      buildInputRepeatUpdate(
        event,
        eventId,
        repeatState,
        repeatedWithinWindow,
      ),
    );
  }

  return items;
}

function buildBucketUpdate(
  event: AnalyticsEvent,
  granularity: Granularity,
  scopeType: ScopeType,
  scopeId: string | null,
  repeatedWithinWindow: boolean,
): TransactItem {
  const bucketStart = bucketStartFor(event.timestamp, granularity);
  const scopeKey = scopeId === null ? scopeType : `${scopeType}#${scopeId}`;
  const latencyBucket = String(
    Math.floor(event.latency_ms / LATENCY_BUCKET_SIZE_MS) * LATENCY_BUCKET_SIZE_MS,
  );
  const latencyBucketAttribute = `latency_bucket_${latencyBucket}_count`;

  return {
    Update: {
      TableName: ANALYTICS_BUCKETS_TABLE,
      Key: {
        pk: `${granularity}#${bucketStart}`,
        sk: `${scopeKey}#${event.event_type}`,
      },
      UpdateExpression:
        "SET granularity = :granularity, bucket_start = :bucketStart, scope_type = :scopeType, " +
        "scope_id = :scopeId, event_type = :eventType, updated_at = :updatedAt, " +
        "#latencyBucketAttribute = if_not_exists(#latencyBucketAttribute, :zero) + :one " +
        "ADD total_count :one, latency_sum_ms :latencyMs, success_count :successCount, " +
        "failure_count :failureCount, cache_hit_count :cacheHitCount, confidence_count :confidenceCount, " +
        "confidence_sum :confidenceSum, confidence_high_count :highConfidenceCount, " +
        "confidence_low_count :lowConfidenceCount, repeated_input_count :repeatedInputCount",
      ExpressionAttributeNames: {
        "#latencyBucketAttribute": latencyBucketAttribute,
      },
      ExpressionAttributeValues: {
        ":granularity": granularity,
        ":bucketStart": bucketStart,
        ":scopeType": scopeType,
        ":scopeId": scopeId,
        ":eventType": event.event_type,
        ":updatedAt": event.timestamp,
        ":zero": 0,
        ":one": 1,
        ":latencyMs": event.latency_ms,
        ":successCount": event.success ? 1 : 0,
        ":failureCount": event.success ? 0 : 1,
        ":cacheHitCount": event.cache_hit ? 1 : 0,
        ":confidenceCount": event.confidence === null ? 0 : 1,
        ":confidenceSum": event.confidence ?? 0,
        ":highConfidenceCount":
          event.confidence !== null && event.confidence >= HIGH_CONFIDENCE_THRESHOLD
            ? 1
            : 0,
        ":lowConfidenceCount":
          event.confidence !== null && event.confidence < LOW_CONFIDENCE_THRESHOLD
            ? 1
            : 0,
        ":repeatedInputCount": repeatedWithinWindow ? 1 : 0,
      },
    },
  };
}

function buildIntentSummaryUpdate(event: AnalyticsEvent): TransactItem {
  const windowStart = bucketStartFor(event.timestamp, "day");
  const counters = eventCounters(event);
  const expressionParts = [
    "SET intent = :intent",
    "window_start = :windowStart",
    "#domain = if_not_exists(#domain, :domain)",
    "first_seen_at = if_not_exists(first_seen_at, :timestamp)",
    "last_seen_at = :timestamp",
    "last_event_type = :eventType",
    "last_success = :success",
    "last_confidence = :confidence",
    "updated_at = :timestamp",
  ];
  const addParts = [
    "total_events :one",
    "resolve_count :resolveCount",
    "resolve_success_count :resolveSuccessCount",
    "resolve_failure_count :resolveFailureCount",
    "execute_count :executeCount",
    "execute_failure_count :executeFailureCount",
    "validate_count :validateCount",
    "validate_failure_count :validateFailureCount",
    "fail_count :failCount",
    "low_confidence_resolve_count :lowConfidenceResolveCount",
  ];
  const values: Record<string, unknown> = {
    ":intent": event.intent,
    ":windowStart": windowStart,
    ":domain": deriveIntentDomain(event.intent!),
    ":timestamp": event.timestamp,
    ":eventType": event.event_type,
    ":success": event.success,
    ":confidence": event.confidence,
    ":one": 1,
    ":resolveCount": counters.resolveCount,
    ":resolveSuccessCount": counters.resolveSuccessCount,
    ":resolveFailureCount": counters.resolveFailureCount,
    ":executeCount": counters.executeCount,
    ":executeFailureCount": counters.executeFailureCount,
    ":validateCount": counters.validateCount,
    ":validateFailureCount": counters.validateFailureCount,
    ":failCount": counters.failCount,
    ":lowConfidenceResolveCount": counters.lowConfidenceResolveCount,
  };

  if (event.skill_id !== null) {
    expressionParts.push("last_skill_id = :skillId");
    addParts.push("distinct_skill_ids :skillSet");
    values[":skillId"] = event.skill_id;
    values[":skillSet"] = new Set([event.skill_id]);
  }

  if (event.input_hash !== null) {
    expressionParts.push("last_input_hash = :inputHash");
    values[":inputHash"] = event.input_hash;
  }

  return {
    Update: {
      TableName: ANALYTICS_INTENT_SUMMARIES_TABLE,
      Key: {
        pk: `day#${windowStart}`,
        sk: `intent#${event.intent}`,
      },
      ExpressionAttributeNames: {
        "#domain": "domain",
      },
      UpdateExpression: `${expressionParts.join(", ")} ADD ${addParts.join(", ")}`,
      ExpressionAttributeValues: values,
    },
  };
}

function buildRecentIssuePut(
  event: AnalyticsEvent,
  eventId: string,
): TransactItem | null {
  const issueType = classifyRecentIssue(event);
  if (issueType === null) {
    return null;
  }

  return {
    Put: {
      TableName: ANALYTICS_RECENT_FEEDS_TABLE,
      Item: {
        pk: `feed#${issueType}`,
        sk: `${event.timestamp}#${eventId}`,
        event_id: eventId,
        issue_type: issueType,
        event_type: event.event_type,
        timestamp: event.timestamp,
        skill_id: event.skill_id,
        intent: event.intent,
        confidence: event.confidence,
        latency_ms: event.latency_ms,
        success: event.success,
        input_hash: event.input_hash,
        cache_hit: event.cache_hit,
        ttl: ttlDaysFrom(event.timestamp, RECENT_ISSUE_TTL_DAYS),
      },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    },
  };
}

function buildInputRepeatUpdate(
  event: AnalyticsEvent,
  eventId: string,
  repeatState: InputRepeatState | null,
  repeatedWithinWindow: boolean,
): TransactItem {
  const values: Record<string, unknown> = {
    ":skillId": event.skill_id,
    ":inputHash": event.input_hash,
    ":timestamp": event.timestamp,
    ":eventId": eventId,
    ":one": 1,
    ":repeatedIncrement": repeatedWithinWindow ? 1 : 0,
  };
  const conditionExpression =
    repeatState?.last_seen_at === undefined
      ? "attribute_not_exists(last_seen_at)"
      : "last_seen_at = :expectedLastSeen";

  if (repeatState?.last_seen_at !== undefined) {
    values[":expectedLastSeen"] = repeatState.last_seen_at;
  }

  const updateSetParts = [
    "skill_id = :skillId",
    "input_hash = :inputHash",
    "first_seen_at = if_not_exists(first_seen_at, :timestamp)",
    "last_seen_at = :timestamp",
    "last_event_id = :eventId",
  ];

  if (repeatedWithinWindow) {
    updateSetParts.push("last_repeated_at = :timestamp");
  }

  return {
    Update: {
      TableName: ANALYTICS_INPUT_STATE_TABLE,
      Key: inputRepeatKey(event.skill_id!, event.input_hash!),
      ConditionExpression: conditionExpression,
      UpdateExpression: `SET ${updateSetParts.join(", ")} ADD seen_count :one, repeated_24h_count :repeatedIncrement`,
      ExpressionAttributeValues: values,
    },
  };
}

function eventCounters(event: AnalyticsEvent) {
  const lowConfidenceResolve =
    event.event_type === "resolve" &&
    event.success &&
    event.confidence !== null &&
    event.confidence < LOW_CONFIDENCE_THRESHOLD;

  return {
    resolveCount: event.event_type === "resolve" ? 1 : 0,
    resolveSuccessCount:
      event.event_type === "resolve" && event.success ? 1 : 0,
    resolveFailureCount:
      event.event_type === "resolve" && !event.success ? 1 : 0,
    executeCount: event.event_type === "execute" ? 1 : 0,
    executeFailureCount:
      event.event_type === "execute" && !event.success ? 1 : 0,
    validateCount: event.event_type === "validate" ? 1 : 0,
    validateFailureCount:
      event.event_type === "validate" && !event.success ? 1 : 0,
    failCount:
      event.event_type === "fail" || event.event_type === "evolve_failed" ? 1 : 0,
    lowConfidenceResolveCount: lowConfidenceResolve ? 1 : 0,
  };
}

function classifyRecentIssue(event: AnalyticsEvent): string | null {
  if (
    event.event_type === "resolve" &&
    event.success &&
    event.confidence !== null &&
    event.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return "resolve_low_confidence";
  }

  if (event.event_type === "resolve" && !event.success) {
    return "resolve_unresolved";
  }

  if (event.event_type === "execute" && !event.success) {
    return "execute_failure";
  }

  if (event.event_type === "validate" && !event.success) {
    return "validate_failure";
  }

  if (
    event.event_type === "fail" ||
    event.event_type === "evolve_failed" ||
    event.event_type === "archive_warning"
  ) {
    return "system_failure";
  }

  return null;
}

function shouldTrackInputRepeat(event: AnalyticsEvent): boolean {
  return (
    event.event_type === "resolve" &&
    event.success &&
    event.skill_id !== null &&
    event.input_hash !== null
  );
}

function isRepeatedWithinWindow(
  event: AnalyticsEvent,
  repeatState: InputRepeatState | null,
): boolean {
  if (!shouldTrackInputRepeat(event) || repeatState?.last_seen_at === undefined) {
    return false;
  }

  const previous = Date.parse(repeatState.last_seen_at);
  const current = Date.parse(event.timestamp);
  if (Number.isNaN(previous) || Number.isNaN(current)) {
    return false;
  }

  return current - previous <= REPEAT_WINDOW_MS;
}

function inputRepeatKey(skillId: string, inputHash: string) {
  return {
    pk: `skill#${skillId}`,
    sk: `input#${inputHash}`,
  };
}

function bucketStartFor(timestamp: string, granularity: Granularity): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid analytics timestamp: ${timestamp}`);
  }

  switch (granularity) {
    case "minute":
      date.setUTCSeconds(0, 0);
      break;
    case "hour":
      date.setUTCMinutes(0, 0, 0);
      break;
    case "day":
      date.setUTCHours(0, 0, 0, 0);
      break;
  }

  return date.toISOString();
}

function deriveIntentDomain(intent: string): string | null {
  const separatorIndex = intent.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const candidate = intent.slice(0, separatorIndex).trim();
  return candidate.length > 0 ? candidate : null;
}

function ttlDaysFrom(timestamp: string, days: number): number {
  return Math.floor(Date.parse(timestamp) / 1000) + days * 24 * 60 * 60;
}

function isDuplicateTransaction(error: unknown): boolean {
  const reasons = transactionCancellationReasons(error);
  return reasons[0]?.Code === "ConditionalCheckFailed";
}

function isRetryableRepeatConflict(error: unknown): boolean {
  const reasons = transactionCancellationReasons(error);
  return reasons.slice(1).some((reason) => reason.Code === "ConditionalCheckFailed");
}

function transactionCancellationReasons(
  error: unknown,
): Array<{ Code?: string }> {
  if (
    error !== null &&
    typeof error === "object" &&
    "CancellationReasons" in error &&
    Array.isArray((error as { CancellationReasons?: unknown[] }).CancellationReasons)
  ) {
    return (error as { CancellationReasons: Array<{ Code?: string }> })
      .CancellationReasons;
  }

  return [];
}
