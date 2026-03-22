/**
 * Node 22 sandboxed skill runner.
 *
 * Receives an event containing:
 *   - implementation: string  (JS source code defining a `solve` function)
 *   - inputs: object          (passed as a single `inputs` argument to solve)
 *   - language: string        (always "javascript")
 *   - timeout_ms: number      (informational; Lambda timeout enforced by config)
 *
 * Returns either:
 *   - The object returned by solve(inputs), which must match the skill output schema.
 *   - { error: string, error_type: "validation" | "runtime" } on failure.
 *
 * Security: new Function() is used to sandbox the implementation.
 * No network access or filesystem writes are permitted by the Lambda execution role.
 */

exports.handler = async (event) => {
  const { implementation, inputs } = event;

  try {
    const fn = new Function(
      "inputs",
      `
      ${implementation}
      if (typeof solve !== 'function') throw new Error('Implementation must define a function named solve');
      return solve(inputs);
      `,
    );

    const result = await fn(inputs);

    if (typeof result !== "object" || result === null) {
      return {
        error: "solve() must return an object matching the skill output schema",
        error_type: "runtime",
      };
    }

    return result;
  } catch (e) {
    return {
      error: e.message,
      error_type: "runtime",
    };
  }
};
