import type { APIGatewayProxyEvent } from "aws-lambda";
import { handler } from "../../../src/router/chain.js";

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
  ScanCommand: jest.fn().mockImplementation((input) => ({ _type: "ScanCommand", input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ _type: "QueryCommand", input })),
}));

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockBedrockSend(...args),
  })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => ({ _type: "InvokeModelCommand", input })),
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
    path: "/chains",
    stageVariables: null,
    requestContext: {} as never,
    resource: "",
  };
}

function makeAxisVector(dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions);
  vec[0] = 1;
  return vec;
}

function makeVectorWithCosine(similarity: number, dimensions: number): Float32Array {
  const clamped = Math.max(-1, Math.min(1, similarity));
  const vec = new Float32Array(dimensions);
  vec[0] = clamped;
  if (dimensions > 1) {
    vec[1] = Math.sqrt(Math.max(0, 1 - clamped * clamped));
  }
  return vec;
}

function encodeEmbedding(vec: Float32Array): number[] {
  return Array.from(vec);
}

function bedrockResponse(vec: Float32Array): { body: Uint8Array } {
  const payload = { embedding: encodeEmbedding(vec) };
  return { body: new TextEncoder().encode(JSON.stringify(payload)) };
}

function makeSkill(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    skill_id: overrides["skill_id"] ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    version_number: 1,
    name: overrides["name"] ?? "Test Skill",
    description: overrides["description"] ?? "A test skill",
    language: overrides["language"] ?? "python",
    status: overrides["status"] ?? "verified",
    is_canonical: overrides["is_canonical"] ?? false,
    confidence: overrides["confidence"] ?? 0.8,
    domain: overrides["domain"] ?? ["algorithms"],
    tags: overrides["tags"] ?? ["sorting"],
    embedding: overrides["embedding"] ?? encodeEmbedding(makeAxisVector(1024)),
  };
}

describe("POST /chains", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a ready local execution plan for explicit intent steps", async () => {
    const intentVec = makeAxisVector(1024);
    mockBedrockSend
      .mockResolvedValueOnce(bedrockResponse(intentVec))
      .mockResolvedValueOnce(bedrockResponse(intentVec));
    mockDocSend
      .mockResolvedValueOnce({
        Items: [makeSkill({ skill_id: "11111111-1111-1111-1111-111111111111", embedding: encodeEmbedding(makeVectorWithCosine(0.95, 1024)) })],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeSkill({ skill_id: "22222222-2222-2222-2222-222222222222", embedding: encodeEmbedding(makeVectorWithCosine(0.95, 1024)) })],
        LastEvaluatedKey: undefined,
      });

    const result = await handler(
      makeEvent({
        steps: [
          { intent: "fetch repo" },
          { intent: "parse json", input_mapping: { previous_output: "input" } },
        ],
      }),
    );
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.ready_for_local_execution).toBe(true);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].best_match.skill_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("accepts a prior intent chain suggestion", async () => {
    mockDocSend
      .mockResolvedValueOnce({
        Items: [makeSkill({ skill_id: "11111111-1111-1111-1111-111111111111" })],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        Items: [makeSkill({ skill_id: "22222222-2222-2222-2222-222222222222" })],
        LastEvaluatedKey: undefined,
      });

    const result = await handler(
      makeEvent({
        suggestion: {
          kind: "intent_chain",
          rationale: "Split into ordered local steps.",
          overall_confidence: 0.8,
          steps: [
            {
              step: 1,
              intent: "fetch repo",
              confidence: 0.8,
              best_match: {
                skill_id: "11111111-1111-1111-1111-111111111111",
                name: "Fetch Repo",
                description: "Fetches a repository",
                language: "python",
                status: "verified",
                is_canonical: false,
                confidence: 0.8,
                similarity_score: 0.8,
                implementation_token_size: null,
                domain: ["algorithms"],
                tags: ["fetch"],
              },
              input_mapping: {},
            },
            {
              step: 2,
              intent: "parse json",
              confidence: 0.8,
              best_match: {
                skill_id: "22222222-2222-2222-2222-222222222222",
                name: "Parse JSON",
                description: "Parses json",
                language: "python",
                status: "verified",
                is_canonical: false,
                confidence: 0.8,
                similarity_score: 0.8,
                implementation_token_size: null,
                domain: ["algorithms"],
                tags: ["json"],
              },
              input_mapping: { previous_output: "input" },
            },
          ],
        },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).source).toBe("suggestion");
  });
});
