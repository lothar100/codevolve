"""
Python 3.12 sandboxed skill runner.

Receives an event containing:
  - implementation: str  (Python source code defining a `solve` function)
  - inputs: dict         (keyword arguments forwarded to solve())
  - language: str        (always "python")
  - timeout_ms: int      (informational; Lambda timeout enforced by config)

Returns either:
  - The dict returned by solve(), which must match the skill output schema.
  - {"error": str, "error_type": "validation" | "runtime"} on failure.

Security: exec() is used in an empty namespace to prevent access to globals.
No network access or filesystem writes are permitted by the Lambda execution role.
"""

import json


def handler(event, context):
    implementation = event.get("implementation", "")
    inputs = event.get("inputs", {})

    local_ns = {}
    try:
        exec(implementation, {}, local_ns)  # noqa: S102

        if "solve" not in local_ns:
            return {
                "error": "Implementation must define a function named solve",
                "error_type": "validation",
            }

        result = local_ns["solve"](**inputs)

        if not isinstance(result, dict):
            return {
                "error": "solve() must return a dict matching the skill output schema",
                "error_type": "runtime",
            }

        return result

    except Exception as e:  # noqa: BLE001
        return {
            "error": str(e),
            "error_type": "runtime",
        }
