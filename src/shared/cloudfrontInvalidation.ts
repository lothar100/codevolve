/**
 * CloudFront cache invalidation utility.
 *
 * Used by write Lambda handlers (createSkill, createProblem, promoteCanonical,
 * archiveSkill, unarchiveSkill) to invalidate stale edge cache entries
 * immediately after a DynamoDB write completes.
 *
 * Per ADR-010 and the Hard Architectural Rule #9:
 *   "Always synchronously initiate CloudFront invalidation within the write
 *    Lambda handler before returning the response."
 *
 * Invalidation is fire-and-try: failures are logged but never crash the handler.
 * The CloudFront API call completes in ~100ms; actual propagation to edge PoPs
 * takes 5–30 seconds (acceptable per ADR-010).
 *
 * Tag-based invalidation is NOT used here because the CloudFront tag-based API
 * requires separate setup (resource tagging + ARN-based calls). Instead we use
 * path-based invalidation on specific patterns per the Invalidation Trigger Table
 * in docs/architecture.md §Edge Caching.
 */

import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

const cloudfrontClient = new CloudFrontClient({
  region: "us-east-1", // CloudFront is a global service; its API endpoint is always us-east-1
});

/**
 * The CloudFront distribution ID is injected at deploy time by CDK.
 * Empty string at local/test time — callers check before invoking.
 */
export const CLOUDFRONT_DISTRIBUTION_ID =
  process.env.CLOUDFRONT_DISTRIBUTION_ID ?? "";

/**
 * Initiate a CloudFront path invalidation for the given paths.
 *
 * - Never throws. Errors are logged to CloudWatch and swallowed.
 * - No-ops if CLOUDFRONT_DISTRIBUTION_ID is not set (dev/test environments).
 * - Uses a random CallerReference per invocation to allow repeated invalidations.
 *
 * @param paths  Array of path patterns to invalidate (e.g. ["/skills*", "/problems/*"])
 */
export async function invalidateCloudFrontPaths(
  paths: string[],
): Promise<void> {
  if (!CLOUDFRONT_DISTRIBUTION_ID) {
    // Not configured — skip invalidation (dev or test environment)
    return;
  }

  try {
    await cloudfrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
          // CallerReference must be unique per invalidation request.
          // Timestamp + random suffix ensures uniqueness even under high write throughput.
          CallerReference: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      }),
    );
  } catch (err) {
    // Invalidation failure must never crash the write handler.
    // Log for CloudWatch alerting but return normally.
    console.error(
      "[invalidateCloudFrontPaths] CloudFront invalidation failed (swallowed):",
      JSON.stringify({ paths, distributionId: CLOUDFRONT_DISTRIBUTION_ID }),
      err,
    );
  }
}
