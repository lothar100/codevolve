/**
 * Test runner interface for the /validate endpoint.
 *
 * The actual execution logic (invoking the sandboxed runner Lambda per test
 * case) will be wired here once ARCH-08 is complete.
 */

import type { Skill } from "../shared/types.js";

export interface TestRunResult {
  passCount: number;
  failCount: number;
  latencyMs: number;
}

// TODO(IMPL-11): wire to runner Lambda once ARCH-08 is complete
export async function runTests(_skill: Skill): Promise<TestRunResult> {
  throw new Error("Test runner not yet implemented — ARCH-08 pending");
}
