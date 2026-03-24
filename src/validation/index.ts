/**
 * Validation module — POST /validate/:skill_id
 *
 * Runs skill tests in a sandboxed runner Lambda, computes confidence,
 * updates DynamoDB, emits analytics event to Kinesis.
 */

export { handler } from "./handler.js";
