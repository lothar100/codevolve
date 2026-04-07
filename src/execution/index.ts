/**
 * Execution Layer module — POST /execute
 *
 * Logs local skill executions for analytics. Skills are run by the caller
 * in their own environment; this endpoint acknowledges and records the event.
 */

export { handler } from "./execute.js";
