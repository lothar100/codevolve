const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  ScanCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { evaluateAutoCache } from "../../../src/decision-engine/rules/autoCache";

const client = { send: mockSend } as unknown as DynamoDBDocumentClient;

const skill = (skill_id: string, version_number = 1, status = "verified") => ({
  skill_id,
  version_number,
  status,
  execution_count: 75,
});

describe("evaluateAutoCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("uses input-state repetition data when available", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { bucket_start: new Date().toISOString(), granularity: "day", event_type: "resolve", scope_type: "skill", scope_id: "skill-a", total_count: 60, repeated_input_count: 30 },
        ],
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [skill("skill-a", 1, "verified")] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await evaluateAutoCache(client);

    expect(mockSend.mock.calls[0][0].input.TableName).toBe("codevolve-analytics-buckets");
    const updateCall = mockSend.mock.calls.at(-1)?.[0] as { input: Record<string, unknown> };
    expect(updateCall.input.Key).toEqual({ skill_id: "skill-a", version_number: 1 });
  });

  it("falls back to execution_count threshold when analytics tables are unavailable", async () => {
    const unavailable = new Error("analytics table not found");
    (unavailable as Error & { name?: string }).name = "ResourceNotFoundException";
    mockSend
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [skill("skill-b", 2, "verified")] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await evaluateAutoCache(client);

    expect(console.warn).toHaveBeenCalled();
    const updateCall = mockSend.mock.calls.at(-1)?.[0] as { input: Record<string, unknown> };
    expect(updateCall.input.Key).toEqual({ skill_id: "skill-b", version_number: 2 });
  });

  it("re-throws unexpected scan failures", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB throttle"));
    await expect(evaluateAutoCache(client)).rejects.toThrow("DynamoDB throttle");
  });

  it("suppresses ConditionalCheckFailedException from the write", async () => {
    const condErr = new Error("Condition not met");
    (condErr as Error & { name?: string }).name = "ConditionalCheckFailedException";
    mockSend
      .mockResolvedValueOnce({
        Items: [{ bucket_start: new Date().toISOString(), granularity: "day", event_type: "resolve", scope_type: "skill", scope_id: "skill-c", total_count: 60, repeated_input_count: 30 }],
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [skill("skill-c")] })
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(condErr);

    await expect(evaluateAutoCache(client)).resolves.toBeUndefined();
  });

  it("writes the expected guard condition", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ bucket_start: new Date().toISOString(), granularity: "day", event_type: "resolve", scope_type: "skill", scope_id: "skill-d", total_count: 60, repeated_input_count: 30 }],
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [skill("skill-d")] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await evaluateAutoCache(client);

    const updateCall = mockSend.mock.calls.at(-1)?.[0] as {
      input: { ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(updateCall.input.ConditionExpression).toBe("attribute_not_exists(auto_cache) OR auto_cache = :false");
    expect(updateCall.input.ExpressionAttributeValues[":true"]).toBe(true);
  });
});
