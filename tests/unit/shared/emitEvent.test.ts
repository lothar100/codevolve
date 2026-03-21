/**
 * Unit tests for the event emission system:
 * - emitEvent / emitEvents (fire-and-forget, Zod validation)
 * - Event builder helpers
 * - POST /events Lambda handler
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { KinesisClient } from "@aws-sdk/client-kinesis";

// ---------------------------------------------------------------------------
// Mock the KinesisClient before importing modules under test
// ---------------------------------------------------------------------------

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-kinesis", () => {
  const actual = jest.requireActual("@aws-sdk/client-kinesis");
  return {
    ...actual,
    KinesisClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

import { emitEvent, emitEvents } from "../../../src/shared/emitEvent";
import {
  buildResolveEvent,
  buildExecuteEvent,
  buildValidateEvent,
  buildFailEvent,
} from "../../../src/shared/eventBuilders";
import { handler } from "../../../src/analytics/emitEvents";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SKILL_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const validEventWithoutTimestamp = {
  event_type: "execute" as const,
  skill_id: VALID_SKILL_ID,
  intent: null,
  latency_ms: 42,
  confidence: 0.95,
  cache_hit: false,
  input_hash: "abc123",
  success: true,
};

function makeApiGatewayEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/events",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "/events",
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({
    Records: [{ SequenceNumber: "seq-001", ShardId: "shard-0" }],
  });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// emitEvent — single event
// ---------------------------------------------------------------------------

describe("emitEvent", () => {
  it("sends a PutRecordCommand to Kinesis with server timestamp", async () => {
    await emitEvent(validEventWithoutTimestamp);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.constructor.name).toBe("PutRecordCommand");

    const input = command.input;
    expect(input.StreamName).toBe("codevolve-events");
    expect(input.PartitionKey).toBe(VALID_SKILL_ID);

    const payload = JSON.parse(Buffer.from(input.Data).toString());
    expect(payload.timestamp).toBeDefined();
    expect(payload.event_type).toBe("execute");
    expect(payload.skill_id).toBe(VALID_SKILL_ID);
  });

  it("uses event_type as partition key when skill_id is null", async () => {
    await emitEvent({ ...validEventWithoutTimestamp, skill_id: null });

    const command = mockSend.mock.calls[0][0];
    expect(command.input.PartitionKey).toBe("execute");
  });

  it("does NOT throw when Kinesis fails (fire-and-forget)", async () => {
    mockSend.mockRejectedValue(new Error("Kinesis is down"));

    // Should not throw
    await expect(emitEvent(validEventWithoutTimestamp)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("drops invalid events with a warning and does NOT throw or call Kinesis", async () => {
    const invalidEvent = {
      ...validEventWithoutTimestamp,
      event_type: "bogus" as any,
    };

    // Must not throw — fire-and-forget even for invalid shapes
    await expect(emitEvent(invalidEvent)).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("drops events with negative latency_ms and does NOT throw", async () => {
    const invalidEvent = {
      ...validEventWithoutTimestamp,
      latency_ms: -1,
    };

    await expect(emitEvent(invalidEvent)).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("drops events with invalid skill_id format and does NOT throw", async () => {
    const invalidEvent = {
      ...validEventWithoutTimestamp,
      skill_id: "not-a-uuid",
    };

    await expect(emitEvent(invalidEvent)).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// emitEvents — batch
// ---------------------------------------------------------------------------

describe("emitEvents", () => {
  it("sends a PutRecordsCommand to Kinesis with all valid events", async () => {
    const events = [
      validEventWithoutTimestamp,
      { ...validEventWithoutTimestamp, skill_id: null, event_type: "resolve" as const },
    ];

    await emitEvents(events);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.constructor.name).toBe("PutRecordsCommand");
    expect(command.input.Records).toHaveLength(2);
  });

  it("drops invalid events from the batch but sends the valid ones", async () => {
    const events = [
      validEventWithoutTimestamp,
      { ...validEventWithoutTimestamp, event_type: "bogus" as any },
    ];

    await emitEvents(events);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.input.Records).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it("does NOT call Kinesis when all events are invalid", async () => {
    const events = [
      { ...validEventWithoutTimestamp, event_type: "bogus" as any },
    ];

    await emitEvents(events);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does NOT throw when Kinesis fails (fire-and-forget)", async () => {
    mockSend.mockRejectedValue(new Error("Kinesis is down"));

    await expect(
      emitEvents([validEventWithoutTimestamp]),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

describe("Event builders", () => {
  describe("buildResolveEvent", () => {
    it("produces a correct resolve event shape", () => {
      const event = buildResolveEvent({
        intent: "find two numbers that sum to target",
        skillId: VALID_SKILL_ID,
        confidence: 0.92,
        latencyMs: 150,
        success: true,
      });

      expect(event.event_type).toBe("resolve");
      expect(event.skill_id).toBe(VALID_SKILL_ID);
      expect(event.intent).toBe("find two numbers that sum to target");
      expect(event.confidence).toBe(0.92);
      expect(event.latency_ms).toBe(150);
      expect(event.success).toBe(true);
      expect(event.cache_hit).toBe(false);
      expect(event.input_hash).toBeNull();
    });

    it("defaults skill_id to null when not provided", () => {
      const event = buildResolveEvent({
        intent: "test",
        confidence: 0,
        latencyMs: 10,
        success: false,
      });
      expect(event.skill_id).toBeNull();
    });
  });

  describe("buildExecuteEvent", () => {
    it("produces a correct execute event shape", () => {
      const event = buildExecuteEvent({
        skillId: VALID_SKILL_ID,
        latencyMs: 50,
        cacheHit: true,
        inputHash: "sha256-abc",
        success: true,
      });

      expect(event.event_type).toBe("execute");
      expect(event.skill_id).toBe(VALID_SKILL_ID);
      expect(event.intent).toBeNull();
      expect(event.latency_ms).toBe(50);
      expect(event.cache_hit).toBe(true);
      expect(event.input_hash).toBe("sha256-abc");
      expect(event.confidence).toBeNull();
      expect(event.success).toBe(true);
    });
  });

  describe("buildValidateEvent", () => {
    it("produces a correct validate event shape", () => {
      const event = buildValidateEvent({
        skillId: VALID_SKILL_ID,
        confidence: 0.85,
        latencyMs: 3000,
        success: true,
      });

      expect(event.event_type).toBe("validate");
      expect(event.skill_id).toBe(VALID_SKILL_ID);
      expect(event.confidence).toBe(0.85);
      expect(event.latency_ms).toBe(3000);
      expect(event.cache_hit).toBe(false);
      expect(event.input_hash).toBeNull();
      expect(event.intent).toBeNull();
    });
  });

  describe("buildFailEvent", () => {
    it("produces a correct fail event shape with reason in intent field", () => {
      const event = buildFailEvent({
        skillId: VALID_SKILL_ID,
        latencyMs: 200,
        reason: "Runtime error in skill execution",
      });

      expect(event.event_type).toBe("fail");
      expect(event.skill_id).toBe(VALID_SKILL_ID);
      expect(event.intent).toBe("Runtime error in skill execution");
      expect(event.success).toBe(false);
      expect(event.confidence).toBeNull();
    });

    it("uses intent when provided instead of reason", () => {
      const event = buildFailEvent({
        intent: "sort an array of objects",
        latencyMs: 100,
        reason: "No matching skill found",
      });

      expect(event.intent).toBe("sort an array of objects");
      expect(event.skill_id).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// POST /events handler
// ---------------------------------------------------------------------------

describe("POST /events handler", () => {
  it("returns 202 with accepted count for a valid batch", async () => {
    const body = {
      events: [
        {
          event_type: "execute",
          skill_id: VALID_SKILL_ID,
          latency_ms: 42,
          success: true,
        },
        {
          event_type: "resolve",
          latency_ms: 100,
          success: true,
          intent: "find two sum",
        },
      ],
    };

    const result = await handler(makeApiGatewayEvent(body));

    expect(result.statusCode).toBe(202);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.accepted).toBe(2);
    expect(responseBody.kinesis_sequence_number).toBe("seq-001");
  });

  it("server-assigns timestamps (not client-provided)", async () => {
    const body = {
      events: [
        {
          event_type: "execute",
          skill_id: VALID_SKILL_ID,
          latency_ms: 10,
          success: true,
        },
      ],
    };

    await handler(makeApiGatewayEvent(body));

    const command = mockSend.mock.calls[0][0];
    const record = command.input.Records[0];
    const payload = JSON.parse(Buffer.from(record.Data).toString());
    expect(payload.timestamp).toBeDefined();
    // Verify the timestamp is a valid ISO string (server-assigned)
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });

  it("returns 400 for empty events array", async () => {
    const body = { events: [] };
    const result = await handler(makeApiGatewayEvent(body));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for events array exceeding 100", async () => {
    const events = Array.from({ length: 101 }, () => ({
      event_type: "execute",
      skill_id: VALID_SKILL_ID,
      latency_ms: 10,
      success: true,
    }));
    const body = { events };
    const result = await handler(makeApiGatewayEvent(body));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for invalid event_type", async () => {
    const body = {
      events: [
        {
          event_type: "unknown",
          latency_ms: 10,
          success: true,
        },
      ],
    };
    const result = await handler(makeApiGatewayEvent(body));
    expect(result.statusCode).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const event = makeApiGatewayEvent({});
    event.body = "not-json{{{";
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it("returns 500 when Kinesis fails", async () => {
    mockSend.mockRejectedValue(new Error("Kinesis down"));

    const body = {
      events: [
        {
          event_type: "execute",
          skill_id: VALID_SKILL_ID,
          latency_ms: 10,
          success: true,
        },
      ],
    };

    const result = await handler(makeApiGatewayEvent(body));
    expect(result.statusCode).toBe(500);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error.code).toBe("INTERNAL_ERROR");
  });

  it("applies defaults for optional fields", async () => {
    const body = {
      events: [
        {
          event_type: "resolve",
          latency_ms: 55,
          success: false,
        },
      ],
    };

    await handler(makeApiGatewayEvent(body));

    const command = mockSend.mock.calls[0][0];
    const record = command.input.Records[0];
    const payload = JSON.parse(Buffer.from(record.Data).toString());
    expect(payload.skill_id).toBeNull();
    expect(payload.intent).toBeNull();
    expect(payload.confidence).toBeNull();
    expect(payload.cache_hit).toBe(false);
    expect(payload.input_hash).toBeNull();
  });
});
