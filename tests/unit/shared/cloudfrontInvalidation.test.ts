/**
 * Unit tests for CloudFront invalidation utility (src/shared/cloudfrontInvalidation.ts).
 *
 * Verifies:
 * - CreateInvalidationCommand is called with correct distribution ID and paths
 * - No-op when CLOUDFRONT_DISTRIBUTION_ID is not set at module load time
 * - Never throws on CloudFront API failure (fire-and-forget)
 * - CallerReference is unique per call
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-cloudfront", () => {
  const actual = jest.requireActual("@aws-sdk/client-cloudfront");
  return {
    ...actual,
    CloudFrontClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

// The module is imported after the mock so the CloudFrontClient mock is in place.
// CLOUDFRONT_DISTRIBUTION_ID defaults to "" in the module when the env var is absent.
import { invalidateCloudFrontPaths } from "../../../src/shared/cloudfrontInvalidation";

const DIST_ID = "E1ABCDEFGHIJKL";

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({
    Invalidation: {
      Id: "I123ABC",
      Status: "InProgress",
      InvalidationBatch: {},
    },
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("invalidateCloudFrontPaths", () => {
  it("is a no-op when CLOUDFRONT_DISTRIBUTION_ID env var is empty (default in test)", async () => {
    // The module-level constant CLOUDFRONT_DISTRIBUTION_ID = "" when env var absent.
    // The function returns immediately without calling the CloudFront client.
    await invalidateCloudFrontPaths(["/skills*"]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when CloudFront API call fails (fire-and-forget)", async () => {
    mockSend.mockRejectedValue(new Error("CloudFront API error"));

    // Even with a failing send, should resolve without throwing
    await expect(
      invalidateCloudFrontPaths(["/skills*"]),
    ).resolves.toBeUndefined();
    // No console.error call expected because distribution ID is empty (no-op path).
    // This test validates that the function is safe to call regardless.
  });

  it("produces a CreateInvalidationCommand with correct Paths when distribution ID is set via env", async () => {
    // Override the module-level constant by setting env var before re-requiring
    process.env.CLOUDFRONT_DISTRIBUTION_ID = DIST_ID;

    // Use jest module registry to get a fresh version of the module with the env var set.
    // Since Jest caches modules, we use jest.resetModules + require.
    jest.resetModules();

    // Re-mock the CloudFront client after resetModules
    jest.mock("@aws-sdk/client-cloudfront", () => {
      const actual = jest.requireActual("@aws-sdk/client-cloudfront");
      return {
        ...actual,
        CloudFrontClient: jest.fn().mockImplementation(() => ({
          send: mockSend,
        })),
      };
    });

    const { invalidateCloudFrontPaths: fn } = require("../../../src/shared/cloudfrontInvalidation");

    await fn(["/skills*", "/problems*"]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0];
    expect(command.constructor.name).toBe("CreateInvalidationCommand");

    const input = command.input;
    expect(input.DistributionId).toBe(DIST_ID);
    expect(input.InvalidationBatch.Paths.Quantity).toBe(2);
    expect(input.InvalidationBatch.Paths.Items).toEqual([
      "/skills*",
      "/problems*",
    ]);

    // Clean up
    delete process.env.CLOUDFRONT_DISTRIBUTION_ID;
    jest.resetModules();
  });

  it("includes a non-empty CallerReference in each CreateInvalidation request", async () => {
    process.env.CLOUDFRONT_DISTRIBUTION_ID = DIST_ID;
    jest.resetModules();

    jest.mock("@aws-sdk/client-cloudfront", () => {
      const actual = jest.requireActual("@aws-sdk/client-cloudfront");
      return {
        ...actual,
        CloudFrontClient: jest.fn().mockImplementation(() => ({
          send: mockSend,
        })),
      };
    });

    const { invalidateCloudFrontPaths: fn } = require("../../../src/shared/cloudfrontInvalidation");

    await fn(["/skills*"]);
    await fn(["/problems*"]);

    const ref1 =
      mockSend.mock.calls[0][0].input.InvalidationBatch.CallerReference;
    const ref2 =
      mockSend.mock.calls[1][0].input.InvalidationBatch.CallerReference;

    expect(ref1).toBeDefined();
    expect(typeof ref1).toBe("string");
    expect(ref1.length).toBeGreaterThan(0);

    expect(ref2).toBeDefined();
    expect(typeof ref2).toBe("string");

    // Each invocation produces a distinct CallerReference
    expect(ref1).not.toBe(ref2);

    delete process.env.CLOUDFRONT_DISTRIBUTION_ID;
    jest.resetModules();
  });

  it("logs an error and swallows the failure when CloudFront throws with a distribution ID set", async () => {
    process.env.CLOUDFRONT_DISTRIBUTION_ID = DIST_ID;
    jest.resetModules();

    const failingSend = jest.fn().mockRejectedValue(new Error("Access Denied"));
    jest.mock("@aws-sdk/client-cloudfront", () => {
      const actual = jest.requireActual("@aws-sdk/client-cloudfront");
      return {
        ...actual,
        CloudFrontClient: jest.fn().mockImplementation(() => ({
          send: failingSend,
        })),
      };
    });

    const { invalidateCloudFrontPaths: fn } = require("../../../src/shared/cloudfrontInvalidation");

    await expect(fn(["/skills*"])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[invalidateCloudFrontPaths]"),
      expect.anything(),
      expect.any(Error),
    );

    delete process.env.CLOUDFRONT_DISTRIBUTION_ID;
    jest.resetModules();
  });

  it("passes a single path correctly with Quantity: 1", async () => {
    process.env.CLOUDFRONT_DISTRIBUTION_ID = DIST_ID;
    jest.resetModules();

    jest.mock("@aws-sdk/client-cloudfront", () => {
      const actual = jest.requireActual("@aws-sdk/client-cloudfront");
      return {
        ...actual,
        CloudFrontClient: jest.fn().mockImplementation(() => ({
          send: mockSend,
        })),
      };
    });

    const { invalidateCloudFrontPaths: fn } = require("../../../src/shared/cloudfrontInvalidation");

    await fn(["/skills/some-skill-id"]);

    const input = mockSend.mock.calls[0][0].input;
    expect(input.InvalidationBatch.Paths.Quantity).toBe(1);
    expect(input.InvalidationBatch.Paths.Items).toEqual([
      "/skills/some-skill-id",
    ]);

    delete process.env.CLOUDFRONT_DISTRIBUTION_ID;
    jest.resetModules();
  });
});
