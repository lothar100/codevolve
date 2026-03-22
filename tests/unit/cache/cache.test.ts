/**
 * Unit tests for src/cache/cache.ts
 *
 * All DynamoDB calls are mocked via jest.mock('@aws-sdk/lib-dynamodb').
 */

import {
  getCachedOutput,
  writeCachedOutput,
  incrementCacheHit,
} from "../../../src/cache/cache.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: (...args: unknown[]) => mockSend(...args),
    }),
  },
  GetCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "GetCommand", input })),
  PutCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "PutCommand", input })),
  UpdateCommand: jest
    .fn()
    .mockImplementation((input) => ({ _type: "UpdateCommand", input })),
}));

// Pull in the mocked constructors so we can inspect call args
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const INPUT_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

// ---------------------------------------------------------------------------
// getCachedOutput
// ---------------------------------------------------------------------------

describe("getCachedOutput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns CachedOutput when item exists (cache hit)", async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        skill_id: SKILL_ID,
        input_hash: INPUT_HASH,
        version_number: 3,
        output: { result: 42 },
        input_snapshot: { n: 10 },
        hit_count: 7,
        created_at: "2026-03-21T00:00:00.000Z",
        ttl: 1742601600,
      },
    });

    const result = await getCachedOutput(SKILL_ID, INPUT_HASH);

    expect(result).not.toBeNull();
    expect(result?.output).toEqual({ result: 42 });
    expect(result?.version_number).toBe(3);
    expect(result?.hit_count).toBe(7);
    expect(result?.created_at).toBe("2026-03-21T00:00:00.000Z");

    // Verify GetCommand was called with correct key
    expect(GetCommand).toHaveBeenCalledWith({
      TableName: "codevolve-cache",
      Key: { skill_id: SKILL_ID, input_hash: INPUT_HASH },
    });
  });

  it("returns null when item does not exist (cache miss)", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await getCachedOutput(SKILL_ID, INPUT_HASH);

    expect(result).toBeNull();
    expect(GetCommand).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// writeCachedOutput
// ---------------------------------------------------------------------------

describe("writeCachedOutput", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes cache entry with correct attributes on success", async () => {
    mockSend.mockResolvedValueOnce({});

    await writeCachedOutput({
      skill_id: SKILL_ID,
      input_hash: INPUT_HASH,
      version_number: 2,
      output: { sorted: [1, 2, 3] },
      input_snapshot: { arr: [3, 1, 2] },
    });

    expect(PutCommand).toHaveBeenCalledTimes(1);

    // Extract the Item that was passed to PutCommand
    const putCallArg = (PutCommand as unknown as jest.Mock).mock.calls[0][0] as {
      TableName: string;
      Item: Record<string, unknown>;
    };

    expect(putCallArg.TableName).toBe("codevolve-cache");

    const item = putCallArg.Item;
    expect(item.skill_id).toBe(SKILL_ID);
    expect(item.input_hash).toBe(INPUT_HASH);
    expect(item.version_number).toBe(2);
    expect(item.output).toEqual({ sorted: [1, 2, 3] });
    expect(item.input_snapshot).toEqual({ arr: [3, 1, 2] });
    expect(item.hit_count).toBe(0);
    expect(typeof item.created_at).toBe("string");
    // created_at must be a valid ISO 8601 string
    expect(() => new Date(item.created_at as string)).not.toThrow();
    expect(new Date(item.created_at as string).toISOString()).toBe(
      item.created_at,
    );
    // last_hit_at must NOT be set on initial write
    expect(item.last_hit_at).toBeUndefined();
    expect(typeof item.ttl).toBe("number");
  });

  it("sets TTL within ±5 seconds of now + 86400", async () => {
    mockSend.mockResolvedValueOnce({});

    const before = Math.floor(Date.now() / 1000) + 86400;

    await writeCachedOutput({
      skill_id: SKILL_ID,
      input_hash: INPUT_HASH,
      version_number: 1,
      output: {},
      input_snapshot: {},
    });

    const after = Math.floor(Date.now() / 1000) + 86400;

    const putCallArg = (PutCommand as unknown as jest.Mock).mock.calls[0][0] as {
      Item: { ttl: number };
    };

    const ttl = putCallArg.Item.ttl;
    expect(ttl).toBeGreaterThanOrEqual(before - 5);
    expect(ttl).toBeLessThanOrEqual(after + 5);
  });
});

// ---------------------------------------------------------------------------
// incrementCacheHit
// ---------------------------------------------------------------------------

describe("incrementCacheHit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls UpdateCommand with ADD hit_count and SET last_hit_at", async () => {
    mockSend.mockResolvedValueOnce({});

    await incrementCacheHit(SKILL_ID, INPUT_HASH);

    expect(UpdateCommand).toHaveBeenCalledTimes(1);

    const updateCallArg = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0] as {
      TableName: string;
      Key: Record<string, unknown>;
      UpdateExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };

    expect(updateCallArg.TableName).toBe("codevolve-cache");
    expect(updateCallArg.Key).toEqual({
      skill_id: SKILL_ID,
      input_hash: INPUT_HASH,
    });

    // Verify the UpdateExpression uses ADD for hit_count and SET for last_hit_at
    expect(updateCallArg.UpdateExpression).toMatch(/ADD\s+hit_count\s+:one/);
    expect(updateCallArg.UpdateExpression).toMatch(
      /SET\s+last_hit_at\s*=\s*:now/,
    );

    expect(updateCallArg.ExpressionAttributeValues[":one"]).toBe(1);
    expect(
      typeof updateCallArg.ExpressionAttributeValues[":now"],
    ).toBe("string");
  });

  it("swallows errors and does not re-throw", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB write failed"));

    // Must not throw
    await expect(
      incrementCacheHit(SKILL_ID, INPUT_HASH),
    ).resolves.toBeUndefined();
  });
});
