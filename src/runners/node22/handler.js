/**
 * Node 22 sandboxed skill runner.
 *
 * Execution contract:
 *   - All input keys are destructured into local variables.
 *   - `require` is available for 'crypto' and 'path' only.
 *   - ES module export syntax (export default, export function) is stripped.
 *   - If a `solve(inputs)` function is defined, it is called automatically.
 *   - Otherwise the implementation uses top-level `return` statements.
 */

const { transform } = require("sucrase");
const nodeCrypto = require("crypto");
const nodePath = require("path");

const ALLOWED_MODULES = { crypto: nodeCrypto, path: nodePath };

function makeRequire() {
  return (mod) => {
    if (ALLOWED_MODULES[mod]) return ALLOWED_MODULES[mod];
    throw new Error(`Module '${mod}' is not available in the sandbox. Allowed: crypto, path.`);
  };
}

exports.handler = async (event) => {
  const { implementation, inputs, language } = event;

  try {
    let code = implementation;

    if (language === "typescript") {
      const result = transform(code, {
        transforms: ["typescript"],
        disableESTransforms: true,
      });
      code = result.code;
    }

    // Strip ES module export syntax unsupported in new Function()
    code = code
      .replace(/export\s+default\s+/g, "")
      .replace(/export\s+(?=(?:async\s+)?(?:function|const|let|var|class))/g, "");

    // Destructure all input keys into local variables
    const inputDecls = Object.keys(inputs ?? {})
      .map((k) => `var ${k} = inputs[${JSON.stringify(k)}];`)
      .join("\n");

    const fn = new Function(
      "inputs",
      "require",
      `
      ${inputDecls}
      ${code}
      if (typeof solve === "function") { return solve(inputs); }
      `,
    );

    const result = await fn(inputs, makeRequire());

    if (result === undefined || result === null) {
      return {
        error: "Implementation returned no value. Define a `solve(inputs)` function or use a top-level `return` statement.",
        error_type: "runtime",
      };
    }

    if (typeof result !== "object") {
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
