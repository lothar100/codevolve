/**
 * Validation module — POST /validate/:skill_id
 *
 * Accepts caller-provided test results and updates skill confidence/status.
 * The caller runs tests locally and reports pass/fail counts here.
 */

export { handler } from "./handler.js";
