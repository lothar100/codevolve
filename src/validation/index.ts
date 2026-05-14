/**
 * Feedback module — POST /validate/:skill_id
 *
 * Accepts caller-provided test feedback and updates skill confidence/status.
 * The caller runs tests locally and reports pass/fail counts here.
 */

export { handler } from "./handler.js";
