/**
 * Evolve module — IMPL-12 (/evolve SQS consumer).
 *
 * This is the Lambda entry point. The handler consumes messages from
 * codevolve-gap-queue.fifo (sent by the Decision Engine), calls the Claude
 * API to generate a candidate skill, and writes it to DynamoDB.
 */

export { handler } from "./handler.js";
