import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { KinesisClient } from '@aws-sdk/client-kinesis';
import { evaluateAutoCache } from './rules/autoCache.js';
import { evaluateOptimizationFlag } from './rules/optimizationFlag.js';
import { evaluateGapDetection } from './rules/gapDetection.js';
import { evaluateArchive } from './rules/archiveEvaluation.js';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqsClient = new SQSClient({});
const kinesisClient = new KinesisClient({});

export const handler: Handler = async (event) => {
  console.log('Decision Engine invoked', JSON.stringify(event));

  // Rule 1: Auto-Cache Trigger
  await evaluateAutoCache(dynamoClient);

  // Rule 2: Optimization Flag
  await evaluateOptimizationFlag(dynamoClient);

  // Rule 3: Gap Detection → GapQueue
  await evaluateGapDetection(dynamoClient, sqsClient);

  // Rule 4: Archive Evaluation → ArchiveQueue
  await evaluateArchive(dynamoClient, sqsClient, kinesisClient);
};
