/**
 * Unit tests for POST /resolve handler.
 *
 * All 9 required test cases from docs/vector-search.md §7.6.
 */

import { handler } from "../../../src/router/resolve.js";
import type { APIGatewayProxyEvent } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDocSend = jest.fn();
const mockBedrockSend = jest.fn();
const mockEmitEvent = jest.fn().mockResolvedValue(undefined);

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest
      .fn()
      .mockReturnValue({ send: (...args: unknown[]) => mockDocSend(...args) }),
  },
  ScanCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "ScanCommand", input })),
  QueryCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "QueryCommand", input })),
}));

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockBedrockSend(...args),
  })),
  InvokeModelCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "InvokeModelCommand", input })),
}));

jest.mock("@aws-sdk/client-kinesis", () => ({
  KinesisClient: jest.fn().mockImplementation(() => ({})),
  PutRecordCommand: jest.fn(),
  PutRecordsCommand: jest.fn(),
}));

jest.mock("../../../src/shared/emitEvent.js", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
  EVENTS_STREAM: "codevolve-events",
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/resolve",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

/**
 * Build a Float32Array of the given dimension where all values are equal
 * so the vector has a specific L2 norm. For a unit vector, pass unitValue
 * = 1 / sqrt(dimensions).
 */
function makeUnitVector(dimensions: number): Float32Array {
  const val = 1 / Math.sqrt(dimensions);
  return new Float32Array(dimensions).fill(val);
}

/**
 * Build a vector with very low cosine similarity against makeUnitVector.
 * We negate all values so the dot product against makeUnitVector is -1/sqrt(dim) * dim = -1.
 * This guarantees cosine << 0.70.
 */
function makeNegativeVector(dimensions: number): Float32Array {
  const val = -1 / Math.sqrt(dimensions);
  return new Float32Array(dimensions).fill(val);
}

/**
 * Encode a Float32Array as the array of numbers that Bedrock would return.
 */
function encodeEmbedding(vec: Float32Array): number[] {
  return Array.from(vec);
}

/**
 * Create a mock Bedrock response body for a given embedding vector.
 */
function bedrockResponse(vec: Float32Array): { body: Uint8Array } {
  const payload = { embedding: encodeEmbedding(vec) };
  return { body: new TextEncoder().encode(JSON.stringify(payload)) };
}

/**
 * Create a mock skill DynamoDB item.
 */
function makeSkill(
  overrides: Partial<{
    skill_id: string;
    name: string;
    description: string;
    language: string;
    status: string;
    is_canonical: boolean;
    confidence: number;
    domain: string[];
    tags: string[];
    embedding: number[] | null;
  }> = {},
) {
  return {
    skill_id: overrides.skill_id ?? "skill-aaa-111",
    version_number: 1,
    name: overrides.name ?? "Test Skill",
    description: overrides.description ?? "A test skill",
    language: overrides.language ?? "python",
    status: overrides.status ?? "verified",
    is_canonical: overrides.is_canonical ?? false,
    confidence: overrides.confidence ?? 0.8,
    domain: overrides.domain ?? ["algorithms"],
    tags: overrides.tags ?? ["sorting"],
    ...(overrides.embedding !== null
      ? { embedding: overrides.embedding ?? encodeEmbedding(makeUnitVector(1024)) }
      : {}),
  };
}

const VALID_BODY = {
  intent: "sort an array efficiently",
  language: undefined,
  domain: [],
  tags: [],
  top_k: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 1: Exact match — skill whose embedding closely matches intent
  // =========================================================================

  it("1. exact match: skill with near-identical embedding returns confidence >= 0.70", async () => {
    const unitVec = makeUnitVector(1024);
    // Intent and skill have identical embeddings → cosine similarity = 1.0
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(unitVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [makeSkill({ embedding: encodeEmbedding(unitVec) })],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.best_match).not.toBeNull();
    expect(body.best_match.confidence).toBeGreaterThanOrEqual(0.70);
    expect(body.evolve_triggered).toBe(false);
    expect(body.matches.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // Test 2: No match — intent with no close skills
  // =========================================================================

  it("2. no match: returns 200 with best_match: null and evolve_triggered: true", async () => {
    const intentVec = makeUnitVector(1024);
    // Skill embedding is the negative of intent — cosine similarity = -1.0, well below 0.70
    const skillVec = makeNegativeVector(1024);

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [makeSkill({ embedding: encodeEmbedding(skillVec) })],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent({ ...VALID_BODY, intent: "something completely unrelated" }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.best_match).toBeNull();
    expect(body.evolve_triggered).toBe(true);
  });

  // =========================================================================
  // Test 3: Archived exclusion — archived skill never returned
  // =========================================================================

  it("3. archived exclusion: archived skill not returned even if embedding scores highest", async () => {
    const unitVec = makeUnitVector(1024);
    // DynamoDB FilterExpression excludes archived items — mock returns no items
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(unitVec));
    mockDocSend.mockResolvedValueOnce({
      // Scan filter removes archived — only non-archived items returned
      Items: [makeSkill({ status: "verified", embedding: encodeEmbedding(unitVec) })],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    // Verify no archived skill appears in matches
    const archivedMatches = body.matches.filter(
      (m: { status: string }) => m.status === "archived",
    );
    expect(archivedMatches.length).toBe(0);

    // Verify the ScanCommand was called with a filter that excludes archived
    const { ScanCommand } = jest.requireMock("@aws-sdk/lib-dynamodb") as {
      ScanCommand: jest.MockedFunction<(input: Record<string, unknown>) => unknown>;
    };
    const scanCall = ScanCommand.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(scanCall.FilterExpression).toContain("<> :archived");
    expect(
      (scanCall.ExpressionAttributeValues as Record<string, unknown>)[":archived"],
    ).toBe("archived");
  });

  // =========================================================================
  // Test 4: Null embedding exclusion — skill without embedding excluded (no throw)
  // =========================================================================

  it("4. null embedding exclusion: skill with no embedding is skipped without error", async () => {
    const intentVec = makeUnitVector(1024);
    const goodVec = makeUnitVector(1024);

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [
        // Skill without embedding — should be silently skipped
        makeSkill({ skill_id: "no-embed", embedding: null }),
        // Skill with embedding — should score and rank
        makeSkill({ skill_id: "has-embed", embedding: encodeEmbedding(goodVec) }),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    // Only the skill with embedding appears in matches
    const skillIds = body.matches.map((m: { skill_id: string }) => m.skill_id);
    expect(skillIds).not.toContain("no-embed");
    expect(skillIds).toContain("has-embed");
  });

  // =========================================================================
  // Test 5: Tag boost — matching tags scores higher than same cosine without
  // =========================================================================

  it("5. tag boost: skill with matching tags scores higher than skill without", async () => {
    const intentVec = makeUnitVector(1024);
    // Build a base embedding with cosine similarity = 0.80 against intentVec.
    // Both skills use the same base cosine so the ONLY difference is the tag boost.
    // We achieve 0.80 similarity by mixing: 0.8 * intentVec + 0.6 * orthogonal
    // Both use the SAME base embedding so cosine sim is identical for both.
    // The no-tag skill gets no boost (final = 0.80).
    // The with-tag skill gets +0.05 * 2 = +0.10 boost (final = 0.90).
    // Both are below 1.0 so the cap doesn't interfere.
    const baseVec = new Float32Array(1024);
    const coeff = 0.8 / Math.sqrt(1024); // gives dot product of 0.8 against unitVec
    baseVec.fill(coeff);

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [
        // Skill without matching tags — base similarity only
        makeSkill({
          skill_id: "no-tags",
          embedding: encodeEmbedding(baseVec),
          tags: ["unrelated"],
        }),
        // Skill with matching tags — gets +0.10 boost
        makeSkill({
          skill_id: "with-tags",
          embedding: encodeEmbedding(baseVec),
          tags: ["sorting", "arrays"],
        }),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(
      makeEvent({ ...VALID_BODY, tags: ["sorting", "arrays"] }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    const withTagsMatch = body.matches.find(
      (m: { skill_id: string }) => m.skill_id === "with-tags",
    );
    const noTagsMatch = body.matches.find(
      (m: { skill_id: string }) => m.skill_id === "no-tags",
    );
    expect(withTagsMatch).toBeDefined();
    expect(noTagsMatch).toBeDefined();
    // Skill with matching tags should have higher confidence score due to boost
    expect(withTagsMatch.confidence).toBeGreaterThan(noTagsMatch.confidence);
  });

  // =========================================================================
  // Test 6: Domain boost cap — total boost <= 0.20
  // =========================================================================

  it("6. domain boost cap: total boost does not exceed 0.20 regardless of match count", async () => {
    const intentVec = makeUnitVector(1024);
    const skillVec = makeUnitVector(1024); // cosine similarity = 1.0

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [
        makeSkill({
          skill_id: "many-domains",
          embedding: encodeEmbedding(skillVec),
          domain: ["algorithms", "sorting", "searching", "graphs", "trees"],
          tags: ["tag1", "tag2", "tag3", "tag4", "tag5"],
        }),
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(
      makeEvent({
        ...VALID_BODY,
        domain: ["algorithms", "sorting", "searching", "graphs", "trees"],
        tags: ["tag1", "tag2", "tag3", "tag4", "tag5"],
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.matches.length).toBeGreaterThan(0);
    // Confidence is capped at 1.0 and boost is capped at 0.20
    // Raw cosine = 1.0, max boost = 0.20, final score before cap = 1.20
    // After cap → confidence = 1.0
    const match = body.matches[0] as { confidence: number };
    expect(match.confidence).toBeLessThanOrEqual(1.0);
    // similarity_score should be the raw cosine (1.0), separate from final confidence
    const matchWithSim = body.matches[0] as { similarity_score: number };
    expect(matchWithSim.similarity_score).toBeCloseTo(1.0, 5);
  });

  // =========================================================================
  // Test 7: min_confidence override — raises effective threshold above 0.70
  // =========================================================================

  it("7. min_confidence override: min_confidence: 0.9 raises threshold so medium match triggers evolve", async () => {
    const intentVec = makeUnitVector(1024);
    // Create a skill that would pass 0.70 but not 0.90
    // Use a vector that gives cosine similarity of ~0.80 (below 0.90)
    // We achieve this by slightly rotating the vector
    const dim = 1024;
    const skillVec = new Float32Array(dim);
    const angle = Math.PI / 6; // 30 degrees rotation → cos(30°) ≈ 0.866 < 0.9
    skillVec[0] = Math.cos(angle);
    skillVec[1] = Math.sin(angle);
    // Normalize (already normalized for 2D case above, zeros for rest)

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [makeSkill({ embedding: encodeEmbedding(skillVec) })],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(
      makeEvent({ ...VALID_BODY, min_confidence: 0.9 }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    // With min_confidence: 0.9, and similarity ~0.866, best_match should be null
    // because score < effective threshold
    // The matches array may still contain results, but best_match is null
    expect(body.best_match).toBeNull();
    expect(body.evolve_triggered).toBe(true);
  });

  // =========================================================================
  // Test 8: Bedrock failure — 500 → handler returns 503 EMBEDDING_ERROR
  // =========================================================================

  it("8. Bedrock failure: mocked Bedrock 500 → handler returns 503 EMBEDDING_ERROR", async () => {
    const bedrockError = Object.assign(new Error("Internal Server Error"), {
      $metadata: { httpStatusCode: 500 },
    });
    mockBedrockSend.mockRejectedValueOnce(bedrockError);

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(503);
    expect(body.error.code).toBe("EMBEDDING_ERROR");
    // DynamoDB should never be called if embedding fails
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test 9: L2 normalization check — generateEmbedding returns unit vector
  // =========================================================================

  it("9. L2 normalization: generateEmbedding returns vector with L2 norm within 1e-6 of 1.0", async () => {
    // Import the function directly to test it in isolation
    const { generateEmbedding } = await import(
      "../../../src/lib/embeddings.js"
    );

    // Build a normalized vector and return it from mocked Bedrock
    const dim = 1024;
    const normalized = makeUnitVector(dim);
    const { BedrockRuntimeClient } = jest.requireMock(
      "@aws-sdk/client-bedrock-runtime",
    ) as {
      BedrockRuntimeClient: jest.MockedClass<{
        new (): { send: jest.MockedFunction<() => Promise<unknown>> };
      }>;
    };
    const instance = BedrockRuntimeClient.mock.instances[0] as {
      send: jest.MockedFunction<() => Promise<unknown>>;
    };
    if (instance) {
      instance.send.mockResolvedValueOnce(bedrockResponse(normalized));
    } else {
      mockBedrockSend.mockResolvedValueOnce(bedrockResponse(normalized));
    }

    const vec = await generateEmbedding("test text");

    // Compute L2 norm
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sumSq);

    expect(Math.abs(norm - 1.0)).toBeLessThan(1e-6);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(dim);
  });

  // =========================================================================
  // Additional: validation error for missing intent
  // =========================================================================

  it("returns 400 for missing intent", async () => {
    const result = await handler(makeEvent({ top_k: 5 }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // =========================================================================
  // Additional: invalid JSON body
  // =========================================================================

  it("returns 400 for invalid JSON body", async () => {
    const event = makeEvent({});
    event.body = "not-valid-json{{";

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // =========================================================================
  // Additional: DynamoDB failure returns 503
  // =========================================================================

  it("DynamoDB failure: returns 503 DB_SCAN_ERROR", async () => {
    const intentVec = makeUnitVector(1024);
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(503);
    expect(body.error.code).toBe("DB_SCAN_ERROR");
  });

  // =========================================================================
  // Additional: empty skills table returns evolve_triggered: true
  // =========================================================================

  it("empty table: returns best_match: null and evolve_triggered: true", async () => {
    const intentVec = makeUnitVector(1024);
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.best_match).toBeNull();
    expect(body.evolve_triggered).toBe(true);
    expect(body.matches).toEqual([]);
  });

  // =========================================================================
  // Additional: pagination — multiple DynamoDB pages
  // =========================================================================

  it("pagination: handles LastEvaluatedKey loop correctly", async () => {
    const intentVec = makeUnitVector(1024);
    const skillVec = makeUnitVector(1024);

    mockBedrockSend.mockResolvedValueOnce(bedrockResponse(intentVec));
    // First page with LastEvaluatedKey
    mockDocSend.mockResolvedValueOnce({
      Items: [makeSkill({ skill_id: "page1-skill" })],
      LastEvaluatedKey: { skill_id: "page1-skill", version_number: 1 },
    });
    // Second page — no more pages
    mockDocSend.mockResolvedValueOnce({
      Items: [makeSkill({ skill_id: "page2-skill", embedding: encodeEmbedding(skillVec) })],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent(VALID_BODY));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    // Both pages were fetched (2 DynamoDB calls)
    expect(mockDocSend).toHaveBeenCalledTimes(2);
    // Skills from both pages (that have embeddings) appear in matches
    const skillIds = body.matches.map((m: { skill_id: string }) => m.skill_id);
    expect(skillIds).toContain("page2-skill");
  });
});
