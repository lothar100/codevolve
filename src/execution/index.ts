/**
 * Local run feedback module — POST /feedback
 *
 * Logs caller-reported local run metadata for analytics. Skills are run by the
 * caller in their own environment; this endpoint acknowledges and records the event.
 */

export { handler } from "./execute.js";
