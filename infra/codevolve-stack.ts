/**
 * Main CDK stack for codeVolve.
 *
 * Creates all DynamoDB tables, Kinesis stream, Lambda functions,
 * and API Gateway routes defined in ARCH-01 and ARCH-02.
 */

import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";
import { execSync } from "child_process";
import * as fs from "fs";

export class CodevolveStack extends cdk.Stack {
  public readonly problemsTable: dynamodb.Table;
  public readonly skillsTable: dynamodb.Table;
  public readonly cacheTable: dynamodb.Table;
  public readonly archiveTable: dynamodb.Table;
  public readonly evolveJobsTable: dynamodb.Table;
  public readonly trustedMountainTable: dynamodb.Table;
  public readonly apiKeysTable: dynamodb.Table;
  public readonly eventsStream: kinesis.Stream;
  public readonly userPool: cognito.UserPool;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // DynamoDB Tables (ARCH-01)
    // -----------------------------------------------------------------------

    // 1. codevolve-problems
    this.problemsTable = new dynamodb.Table(this, "ProblemsTable", {
      tableName: "codevolve-problems",
      partitionKey: { name: "problem_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.problemsTable.addGlobalSecondaryIndex({
      indexName: "GSI-status-domain",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "domain_primary", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 2. codevolve-skills
    this.skillsTable = new dynamodb.Table(this, "SkillsTable", {
      tableName: "codevolve-skills",
      partitionKey: { name: "skill_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "version_number", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    this.skillsTable.addGlobalSecondaryIndex({
      indexName: "GSI-problem-status",
      partitionKey: { name: "problem_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.skillsTable.addGlobalSecondaryIndex({
      indexName: "GSI-language-confidence",
      partitionKey: { name: "language", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "confidence", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.skillsTable.addGlobalSecondaryIndex({
      indexName: "GSI-status-updated",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updated_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.skillsTable.addGlobalSecondaryIndex({
      indexName: "GSI-canonical",
      partitionKey: {
        name: "is_canonical_status",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "problem_id", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["skill_id", "name", "language", "confidence"],
    });

    // 3. codevolve-cache (DynamoDB TTL — ADR-003, no ElastiCache)
    //
    // PROVISIONED BUT CURRENTLY INACTIVE.
    // No Lambda reads from or writes to this table today. The execution handler
    // (src/execution/execute.ts) only increments execution_count on the skill
    // record and emits a Kinesis event — it does not check or populate this cache.
    //
    // The cache layer design is pending BETA-07, which will redefine the
    // validate/cache contract for the local CLI execution model. Once BETA-07 is
    // resolved the Decision Engine auto-cache rule (Rule 1: high execution_count +
    // high input_repeat_rate → cache) will begin writing here.
    this.cacheTable = new dynamodb.Table(this, "CacheTable", {
      tableName: "codevolve-cache",
      partitionKey: { name: "skill_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "input_hash", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    this.cacheTable.addGlobalSecondaryIndex({
      indexName: "GSI-skill-hitcount",
      partitionKey: { name: "skill_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "hit_count", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["input_hash", "version_number", "last_hit_at"],
    });

    // 4. codevolve-archive (audit log)
    this.archiveTable = new dynamodb.Table(this, "ArchiveTable", {
      tableName: "codevolve-archive",
      partitionKey: { name: "entity_id", type: dynamodb.AttributeType.STRING },
      sortKey: {
        name: "action_timestamp",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.archiveTable.addGlobalSecondaryIndex({
      indexName: "GSI-type-action",
      partitionKey: {
        name: "entity_type",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "action_timestamp",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.archiveTable.addGlobalSecondaryIndex({
      indexName: "GSI-action-timestamp",
      partitionKey: { name: "action", type: dynamodb.AttributeType.STRING },
      sortKey: {
        name: "action_timestamp",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ["entity_id", "entity_type", "reason"],
    });

    // 5. codevolve-evolve-jobs (IMPL-12 — evolve job tracking, 30-day TTL)
    this.evolveJobsTable = new dynamodb.Table(this, "EvolveJobsTable", {
      tableName: "codevolve-evolve-jobs",
      partitionKey: { name: "evolve_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
    });

    this.evolveJobsTable.addGlobalSecondaryIndex({
      indexName: "GSI-status-created",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 6. codevolve-trusted-mountains (IMPL-16)
    this.trustedMountainTable = new dynamodb.Table(this, "TrustedMountainTable", {
      tableName: "codevolve-trusted-mountains",
      partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "skill_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 7. codevolve-gap-log (Decision Engine Rule 3 — ARCH-07 §4.3.1)
    // Tracks unresolved resolve attempts for gap detection.
    // Written by /resolve Lambda, read by Decision Engine.
    const gapLogTable = new dynamodb.Table(this, "GapLogTable", {
      tableName: "codevolve-gap-log",
      partitionKey: { name: "intent_hash", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // 8. codevolve-config (Decision Engine archive gate + feature flags — ARCH-07 §8.2)
    // Key–value configuration store for runtime Decision Engine parameters.
    const configTable = new dynamodb.Table(this, "ConfigTable", {
      tableName: "codevolve-config",
      partitionKey: { name: "config_key", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 9. codevolve-api-keys (BETA-03 — agent-friendly API key system)
    // Stores SHA-256 hashes of API keys. Raw keys are NEVER stored.
    // gsi-key-hash enables O(1) lookup by key hash in the authorizer.
    // gsi-owner enables listing all keys for a given owner.
    this.apiKeysTable = new dynamodb.Table(this, "ApiKeysTable", {
      tableName: "codevolve-api-keys",
      partitionKey: { name: "key_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.apiKeysTable.addGlobalSecondaryIndex({
      indexName: "gsi-key-hash",
      partitionKey: { name: "api_key_hash", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.apiKeysTable.addGlobalSecondaryIndex({
      indexName: "gsi-owner",
      partitionKey: { name: "owner_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------------
    // Cognito — Community User Pool (IMPL-16)
    // -----------------------------------------------------------------------

    this.userPool = new cognito.UserPool(this, "CommunityUserPool", {
      userPoolName: "codevolve-community",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: "codevolve-spa",
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
    });
    // -----------------------------------------------------------------------
    // Kinesis Data Stream
    // -----------------------------------------------------------------------

    this.eventsStream = new kinesis.Stream(this, "EventsStream", {
      streamName: "codevolve-events",
      shardCount: 1, // start small; on-demand mode can be enabled later
      retentionPeriod: cdk.Duration.hours(24),
    });

    // -----------------------------------------------------------------------
    // Shared Lambda environment variables
    // -----------------------------------------------------------------------

    const lambdaEnvironment: Record<string, string> = {
      PROBLEMS_TABLE: this.problemsTable.tableName,
      SKILLS_TABLE: this.skillsTable.tableName,
      ARCHIVE_TABLE: this.archiveTable.tableName,
      EVENTS_STREAM: this.eventsStream.streamName,
      KINESIS_STREAM_NAME: this.eventsStream.streamName,
      API_KEYS_TABLE: this.apiKeysTable.tableName,
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
    };

    // -----------------------------------------------------------------------
    // Lambda Functions
    // -----------------------------------------------------------------------

    // Shared props for all Node.js Lambda functions (uses local esbuild, no Docker)
    const commonNodejsProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: lambdaEnvironment,
      handler: "handler",
      bundling: { externalModules: ["@aws-sdk/*"] },
    };

    // Health check
    const healthFn = new NodejsFunction(this, "HealthFn", {
      ...commonNodejsProps,
      functionName: "codevolve-health",
      entry: path.join(__dirname, "../src/shared/health.ts"),
    });

    // Discovery: GET /
    const discoveryFn = new NodejsFunction(this, "DiscoveryFn", {
      ...commonNodejsProps,
      functionName: "codevolve-discovery",
      entry: path.join(__dirname, "../src/registry/discovery.ts"),
    });

    // --- Registry Lambda functions (IMPL-02) ---

    const createSkillFn = new NodejsFunction(this, "CreateSkillFn", {
      ...commonNodejsProps,
      functionName: "codevolve-create-skill",
      entry: path.join(__dirname, "../src/registry/createSkill.ts"),
    });

    const getSkillFn = new NodejsFunction(this, "GetSkillFn", {
      ...commonNodejsProps,
      functionName: "codevolve-get-skill",
      entry: path.join(__dirname, "../src/registry/getSkill.ts"),
    });

    const listSkillsFn = new NodejsFunction(this, "ListSkillsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-list-skills",
      entry: path.join(__dirname, "../src/registry/listSkills.ts"),
    });

    const listSkillVersionsFn = new NodejsFunction(this, "ListSkillVersionsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-list-skill-versions",
      entry: path.join(__dirname, "../src/registry/listSkillVersions.ts"),
    });

    const promoteCanonicalFn = new NodejsFunction(this, "PromoteCanonicalFn", {
      ...commonNodejsProps,
      functionName: "codevolve-promote-canonical",
      entry: path.join(__dirname, "../src/registry/promoteCanonical.ts"),
    });

    const createProblemFn = new NodejsFunction(this, "CreateProblemFn", {
      ...commonNodejsProps,
      functionName: "codevolve-create-problem",
      entry: path.join(__dirname, "../src/registry/createProblem.ts"),
    });

    const getProblemFn = new NodejsFunction(this, "GetProblemFn", {
      ...commonNodejsProps,
      functionName: "codevolve-get-problem",
      entry: path.join(__dirname, "../src/registry/getProblem.ts"),
    });

    const listProblemsFn = new NodejsFunction(this, "ListProblemsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-list-problems",
      entry: path.join(__dirname, "../src/registry/listProblems.ts"),
    });

    const registryFunctions = [
      createSkillFn,
      getSkillFn,
      listSkillsFn,
      listSkillVersionsFn,
      promoteCanonicalFn,
      createProblemFn,
      getProblemFn,
      listProblemsFn,
    ];

    // Router: POST /intent (IMPL-05)
    const resolveFn = new NodejsFunction(this, "ResolveFn", {
      ...commonNodejsProps,
      functionName: "codevolve-resolve",
      entry: path.join(__dirname, "../src/router/resolve.ts"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    });

    // Validation: POST /validate/{skill_id} — accepts caller-provided test results (IMPL-11-B)
    const validateFn = new NodejsFunction(this, "ValidateFn", {
      ...commonNodejsProps,
      functionName: "codevolve-validate",
      entry: path.join(__dirname, "../src/validation/handler.ts"),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
    });

    // Analytics: POST /events
    const emitEventsFn = new NodejsFunction(this, "EmitEventsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-emit-events",
      entry: path.join(__dirname, "../src/analytics/emitEvents.ts"),
    });

    // Evolve: POST /evolve
    // TODO: IMPL-12 — implement evolve handler

    // -----------------------------------------------------------------------
    // Analytics Consumer (IMPL-08-B)
    // -----------------------------------------------------------------------

    // Import ClickHouse credentials secret (managed outside CDK).
    // The secret must contain JSON with keys: url, username, password, database.
    const clickhouseSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClickHouseSecret",
      "codevolve/clickhouse-credentials",
    );

    // Shared ClickHouse env vars — injected into every Lambda that queries ClickHouse.
    // Secret format: { host, port, database, username, password }
    // Values are resolved at synth/deploy time from Secrets Manager JSON fields.
    // Rotate credentials via Secrets Manager rotation (no re-deploy required).
    const clickhouseEnv = {
      CLICKHOUSE_HOST: clickhouseSecret.secretValueFromJson("host").unsafeUnwrap(),
      CLICKHOUSE_PORT: clickhouseSecret.secretValueFromJson("port").unsafeUnwrap(),
      CLICKHOUSE_USER: clickhouseSecret.secretValueFromJson("username").unsafeUnwrap(),
      CLICKHOUSE_PASSWORD: clickhouseSecret.secretValueFromJson("password").unsafeUnwrap(),
      CLICKHOUSE_DATABASE: clickhouseSecret.secretValueFromJson("database").unsafeUnwrap(),
    };

    // GET /analytics/dashboards/:type (IMPL-09)
    const dashboardsFn = new NodejsFunction(this, "DashboardsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-dashboards",
      entry: path.join(__dirname, "../src/analytics/dashboards.ts"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60), // 5 concurrent ClickHouse queries per dashboard; match analyticsConsumerFn
      environment: {
        ...lambdaEnvironment,
        ...clickhouseEnv,
      },
    });

    // DLQ for failed analytics consumer batches
    const analyticsConsumerDlq = new sqs.Queue(this, "AnalyticsConsumerDlq", {
      queueName: "codevolve-analytics-consumer-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    // Analytics consumer Lambda — reads from Kinesis, writes to ClickHouse.
    // CRITICAL fix (REVIEW-08-IMPL08-RECHECK): inject the four env vars that
    // clickhouseClient.ts reads at runtime. The old CLICKHOUSE_SECRET_ARN env
    // var has been removed — it was dead after the client was rewritten to use
    // direct env vars.
    const analyticsConsumerFn = new NodejsFunction(
      this,
      "AnalyticsConsumerFn",
      {
        ...commonNodejsProps,
        functionName: "codevolve-analytics-consumer",
        entry: path.join(__dirname, "../src/analytics/consumer.ts"),
        memorySize: 512,
        timeout: cdk.Duration.seconds(60), // W-01 fix: spec §3.2 requires 60s, not 300s
        environment: {
          ...lambdaEnvironment,
          ...clickhouseEnv,
        },
      },
    );

    // Wire Kinesis stream to analytics consumer
    analyticsConsumerFn.addEventSource(
      new lambdaEventSources.KinesisEventSource(this.eventsStream, {
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
        retryAttempts: 3,
        onFailure: new lambdaEventSources.SqsDlq(analyticsConsumerDlq),
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        bisectBatchOnError: true,
      }),
    );

    // CloudWatch alarm: sustained backlog in analytics DLQ.
    // W-02 fix: metricApproximateNumberOfMessagesVisible stays elevated while
    // unprocessed messages remain; metricNumberOfMessagesSent would reset each period.
    new cloudwatch.Alarm(this, "AnalyticsConsumerDlqAlarm", {
      alarmName: "codevolve-analytics-consumer-dlq-nonempty",
      metric: analyticsConsumerDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // -----------------------------------------------------------------------
    // SQS Queues (IMPL-04 — Archive Mechanism, IMPL-12 — Evolve Gap Queue)
    // -----------------------------------------------------------------------

    // Evolve gap queue — FIFO, consumed by EvolveFn (IMPL-12-B)
    const evolveDlq = new sqs.Queue(this, "EvolveDlq", {
      queueName: "codevolve-evolve-dlq.fifo",
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const evolveGapQueue = new sqs.Queue(this, "EvolveGapQueue", {
      queueName: "codevolve-evolve-gap-queue.fifo",
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(300), // matches EvolveFn timeout
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: evolveDlq,
        maxReceiveCount: 3,
      },
    });

    // Evolve Lambda — SQS consumer for gap queue (IMPL-12-B)
    const evolveFn = new NodejsFunction(this, "EvolveFn", {
      ...commonNodejsProps,
      functionName: "codevolve-evolve",
      entry: path.join(__dirname, "../src/evolve/handler.ts"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(300), // 5 min — Claude API call may take 30-60s
    });

    // Wire SQS gap queue to evolve Lambda
    evolveFn.addEventSource(
      new lambdaEventSources.SqsEventSource(evolveGapQueue, {
        batchSize: 1, // FIFO: one job per invocation — simplifies error handling
        reportBatchItemFailures: true,
      }),
    );

    const archiveDlq = new sqs.Queue(this, "ArchiveDLQ", {
      queueName: "codevolve-archive-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const archiveQueue = new sqs.Queue(this, "ArchiveQueue", {
      queueName: "codevolve-archive-queue",
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      deadLetterQueue: {
        queue: archiveDlq,
        maxReceiveCount: 3,
      },
    });

    // -----------------------------------------------------------------------
    // Archive Lambda Functions (IMPL-04)
    // -----------------------------------------------------------------------

    const archiveSkillFn = new NodejsFunction(this, "ArchiveSkillFn", {
      ...commonNodejsProps,
      functionName: "codevolve-archive-skill",
      entry: path.join(__dirname, "../src/archive/archiveSkill.ts"),
    });

    const unarchiveSkillFn = new NodejsFunction(this, "UnarchiveSkillFn", {
      ...commonNodejsProps,
      functionName: "codevolve-unarchive-skill",
      entry: path.join(__dirname, "../src/archive/unarchiveSkill.ts"),
      timeout: cdk.Duration.seconds(60), // longer timeout for Bedrock embedding regeneration
    });

    const archiveHandlerFn = new NodejsFunction(this, "ArchiveHandlerFn", {
      ...commonNodejsProps,
      functionName: "codevolve-archive-handler",
      entry: path.join(__dirname, "../src/archive/archiveHandler.ts"),
      timeout: cdk.Duration.seconds(300), // matches SQS visibility timeout
    });

    // Wire SQS archive queue to archive handler Lambda
    archiveHandlerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(archiveQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // Auth: custom JWT authorizer Lambda (IMPL-16 — backup for non-APIGW contexts)
    const authorizerFn = new NodejsFunction(this, "AuthorizerFn", {
      ...commonNodejsProps,
      functionName: "codevolve-authorizer",
      entry: path.join(__dirname, "../src/auth/authorizer.ts"),
      timeout: cdk.Duration.seconds(5),
      environment: {
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
        COGNITO_REGION: this.region,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      },
    });

    // API Key Authorizer (BETA-03 — TOKEN-type custom authorizer)
    // Validates X-Api-Key header against codevolve-api-keys table via gsi-key-hash.
    const apiKeyAuthorizerFn = new NodejsFunction(this, "ApiKeyAuthorizerFn", {
      ...commonNodejsProps,
      functionName: "codevolve-api-key-authorizer",
      entry: path.join(__dirname, "../src/auth/apiKeyAuthorizer.ts"),
      timeout: cdk.Duration.seconds(10),
      environment: {
        API_KEYS_TABLE: this.apiKeysTable.tableName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      },
    });

    // API Key management handlers (BETA-03)
    const createApiKeyFn = new NodejsFunction(this, "CreateApiKeyFn", {
      ...commonNodejsProps,
      functionName: "codevolve-create-api-key",
      entry: path.join(__dirname, "../src/auth/createApiKey.ts"),
    });

    const listApiKeysFn = new NodejsFunction(this, "ListApiKeysFn", {
      ...commonNodejsProps,
      functionName: "codevolve-list-api-keys",
      entry: path.join(__dirname, "../src/auth/listApiKeys.ts"),
    });

    const deleteApiKeyFn = new NodejsFunction(this, "DeleteApiKeyFn", {
      ...commonNodejsProps,
      functionName: "codevolve-delete-api-key",
      entry: path.join(__dirname, "../src/auth/deleteApiKey.ts"),
    });

    // Trusted Mountain: GET/POST/DELETE /users/me/trusted-mountain (IMPL-16)
    const trustedMountainFn = new NodejsFunction(this, "TrustedMountainFn", {
      ...commonNodejsProps,
      functionName: "codevolve-trusted-mountain",
      entry: path.join(__dirname, "../src/registry/trustedMountain.ts"),
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...lambdaEnvironment,
        TRUSTED_MOUNTAIN_TABLE: this.trustedMountainTable.tableName,
        COGNITO_USER_POOL_ID: this.userPool.userPoolId,
        COGNITO_REGION: this.region,
      },
    });

    // -----------------------------------------------------------------------
    // Decision Engine Lambda (IMPL-10 — ARCH-07)
    // -----------------------------------------------------------------------

    // DecisionEngineFn — scheduled Lambda that evaluates four rules:
    //   Rule 1: auto-cache trigger
    //   Rule 2: optimization flag
    //   Rule 3: gap detection → evolveGapQueue
    //   Rule 4: archive evaluation → archiveQueue
    //
    // reservedConcurrentExecutions: 1 prevents overlapping invocations.
    // Timeout 240s (4 min) gives a 1-min gap before the next 5-min schedule.
    const decisionEngineFn = new NodejsFunction(this, "DecisionEngineFn", {
      ...commonNodejsProps,
      functionName: "codevolve-decision-engine",
      entry: path.join(__dirname, "../src/decision-engine/handler.ts"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(240),
      environment: {
        ...lambdaEnvironment,
        SKILLS_TABLE: this.skillsTable.tableName,
        GAP_LOG_TABLE: gapLogTable.tableName,
        CONFIG_TABLE: configTable.tableName,
        GAP_QUEUE_URL: evolveGapQueue.queueUrl,
        ARCHIVE_QUEUE_URL: archiveQueue.queueUrl,
      },
    });

    // EventBridge rule: fire every 5 minutes (ARCH-07 §2.1)
    const decisionEngineSchedule = new events.Rule(
      this,
      "DecisionEngineSchedule",
      {
        ruleName: "codevolve-decision-engine-schedule",
        schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      },
    );

    decisionEngineSchedule.addTarget(
      new eventsTargets.LambdaFunction(decisionEngineFn, {
        retryAttempts: 2,
      }),
    );

    // -----------------------------------------------------------------------
    // API Gateway
    // -----------------------------------------------------------------------

    this.api = new apigateway.RestApi(this, "CodevolveApi", {
      restApiName: "codevolve-api",
      description: "codeVolve — AI-native skill registry API",
      deployOptions: {
        stageName: "v1",
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "Accept",
          "X-Request-Id",
          "X-Agent-Id",
          "Authorization",
          "X-Api-Key",
        ],
      },
    });

    // -----------------------------------------------------------------------
    // Cognito Authorizer (IMPL-16)
    // -----------------------------------------------------------------------

    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [this.userPool],
        authorizerName: "CommunityUserPoolAuthorizer",
        identitySource: "method.request.header.Authorization",
      },
    );

    // Shorthand for methods that require Cognito auth
    const withAuth: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // -----------------------------------------------------------------------
    // API Key TOKEN Authorizer (BETA-03)
    // -----------------------------------------------------------------------

    // TOKEN-type custom authorizer that reads the X-Api-Key header.
    // Used on all write endpoints so agents can use long-lived API keys
    // instead of 1-hour Cognito tokens.
    //
    // TODO (BETA-02): Associate this authorizer's API keys with the
    // UsagePlan created in BETA-02 (codevolveUsagePlan) once that task
    // is complete and the UsagePlan construct is available in this stack.
    const apiKeyTokenAuthorizer = new apigateway.TokenAuthorizer(
      this,
      "ApiKeyTokenAuthorizer",
      {
        handler: apiKeyAuthorizerFn,
        authorizerName: "ApiKeyAuthorizer",
        identitySource: "method.request.header.X-Api-Key",
        resultsCacheTtl: cdk.Duration.seconds(300),
      },
    );

    // Shorthand for methods that accept API key auth
    const withApiKeyAuth: apigateway.MethodOptions = {
      authorizer: apiKeyTokenAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    };

    // GET / — discovery document
    this.api.root.addMethod(
      "GET",
      new apigateway.LambdaIntegration(discoveryFn),
    );

    // GET /health
    const healthResource = this.api.root.addResource("health");
    healthResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(healthFn),
    );

    // /skills
    const skillsResource = this.api.root.addResource("skills");
    skillsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listSkillsFn),
    );
    skillsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createSkillFn),
      withApiKeyAuth,
    );
    const skillByIdResource = skillsResource.addResource("{id}");
    skillByIdResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getSkillFn),
    );
    const versionsResource = skillByIdResource.addResource("versions");
    versionsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listSkillVersionsFn),
    );
    const promoteCanonicalResource =
      skillByIdResource.addResource("promote-canonical");
    promoteCanonicalResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(promoteCanonicalFn),
      withApiKeyAuth,
    );
    const archiveResource = skillByIdResource.addResource("archive");
    archiveResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(archiveSkillFn),
    );
    const unarchiveResource = skillByIdResource.addResource("unarchive");
    unarchiveResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(unarchiveSkillFn),
    );

    // /problems
    const problemsResource = this.api.root.addResource("problems");
    problemsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createProblemFn),
      withApiKeyAuth,
    );
    problemsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listProblemsFn),
    );
    const problemByIdResource = problemsResource.addResource("{id}");
    problemByIdResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getProblemFn),
    );

    // /intent (IMPL-05)
    const resolveResource = this.api.root.addResource("intent");
    resolveResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(resolveFn),
    );

    // /validate (IMPL-11-B)
    const validateResource = this.api.root.addResource("validate");
    const validateBySkillIdResource = validateResource.addResource("{skill_id}");
    validateBySkillIdResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(validateFn),
      withApiKeyAuth,
    );

    // /events
    const eventsResource = this.api.root.addResource("events");
    eventsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(emitEventsFn),
      withApiKeyAuth,
    );

    // /analytics
    const analyticsResource = this.api.root.addResource("analytics");
    const dashboardsResource = analyticsResource.addResource("dashboards");
    const dashboardsByTypeResource = dashboardsResource.addResource("{type}");
    dashboardsByTypeResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(dashboardsFn),
    );

    // /evolve — no HTTP route. The evolve pipeline is triggered exclusively via
    // the SQS gap queue (populated by the Decision Engine on low-confidence resolves).
    // evolveFn is wired to that SQS queue as an event source below. A caller
    // POSTing to /evolve directly has no handler to reach; the resource is not
    // exposed over API Gateway.
    // POST /evolve

    // /auth/keys (BETA-03 — API key management)
    // POST /auth/keys and GET /auth/keys accept both Cognito and API key auth.
    // DELETE /auth/keys/{key_id} also accepts both.
    const authResource = this.api.root.addResource("auth");
    const keysResource = authResource.addResource("keys");
    keysResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createApiKeyFn),
      withApiKeyAuth,
    );
    keysResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listApiKeysFn),
      withApiKeyAuth,
    );
    const keyByIdResource = keysResource.addResource("{key_id}");
    keyByIdResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(deleteApiKeyFn),
      withApiKeyAuth,
    );

    // /users/me/trusted-mountain (IMPL-16)
    const usersResource = this.api.root.addResource("users");
    const meResource = usersResource.addResource("me");
    const trustedMountainResource = meResource.addResource("trusted-mountain");
    trustedMountainResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(trustedMountainFn),
      withAuth,
    );
    trustedMountainResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(trustedMountainFn),
      withAuth,
    );
    const trustedMountainSkillResource =
      trustedMountainResource.addResource("{skill_id}");
    trustedMountainSkillResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(trustedMountainFn),
      withAuth,
    );

    // -----------------------------------------------------------------------
    // Grant permissions
    // -----------------------------------------------------------------------

    // healthFn needs no DynamoDB or Kinesis access — it returns a static response
    this.eventsStream.grantWrite(emitEventsFn);

    // Registry function permissions (IMPL-02)
    for (const fn of registryFunctions) {
      this.problemsTable.grantReadWriteData(fn);
      this.skillsTable.grantReadWriteData(fn);
      this.eventsStream.grantWrite(fn);
    }

    // Bedrock invoke permission for createSkill (embedding generation)
    createSkillFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    // Archive function permissions (IMPL-04)
    const archiveFunctions = [archiveSkillFn, unarchiveSkillFn, archiveHandlerFn];
    for (const fn of archiveFunctions) {
      this.problemsTable.grantReadWriteData(fn);
      this.skillsTable.grantReadWriteData(fn);
      this.archiveTable.grantReadWriteData(fn);
      this.eventsStream.grantWrite(fn);
    }

    // Bedrock invoke permission for unarchive (embedding regeneration)
    unarchiveSkillFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    // SQS consume permission for archive handler
    archiveQueue.grantConsumeMessages(archiveHandlerFn);

    // Resolve function permissions (IMPL-05)
    this.skillsTable.grantReadData(resolveFn);
    this.eventsStream.grantWrite(resolveFn);
    resolveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );

    // ValidateFn permissions (IMPL-11-B)
    this.skillsTable.grantReadWriteData(validateFn);
    this.eventsStream.grantWrite(validateFn);
    evolveGapQueue.grantSendMessages(validateFn);
    validateFn.addEnvironment("GAP_QUEUE_URL", evolveGapQueue.queueUrl);

    // EvolveFn permissions (IMPL-12-B)
    this.skillsTable.grantReadWriteData(evolveFn);
    this.problemsTable.grantReadWriteData(evolveFn);
    this.evolveJobsTable.grantReadWriteData(evolveFn);
    this.eventsStream.grantWrite(evolveFn);
    evolveGapQueue.grantConsumeMessages(evolveFn);
    evolveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:codevolve/anthropic-api-key*`,
        ],
      }),
    );
    // Pass ANTHROPIC_SECRET_ARN and EVOLVE_JOBS_TABLE at deploy-time
    evolveFn.addEnvironment(
      "ANTHROPIC_SECRET_ARN",
      `arn:aws:secretsmanager:${this.region}:${this.account}:secret:codevolve/anthropic-api-key`,
    );
    evolveFn.addEnvironment(
      "EVOLVE_JOBS_TABLE",
      this.evolveJobsTable.tableName,
    );
    evolveFn.addEnvironment(
      "GAP_QUEUE_URL",
      evolveGapQueue.queueUrl,
    );

    // PromoteCanonicalFn additional permissions (IMPL-13-A)
    // TransactWriteItems is not included in grantReadWriteData — add explicitly
    promoteCanonicalFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:TransactWriteItems"],
        resources: [
          this.skillsTable.tableArn,
          this.problemsTable.tableArn,
        ],
      }),
    );
    // Pass GAP_QUEUE_URL so ValidateFn can enqueue gaps (reuse evolveGapQueue ref)
    validateFn.addEnvironment("GAP_QUEUE_URL", evolveGapQueue.queueUrl);

    // Analytics consumer permissions (IMPL-08-B, W-01/W-02 fixes applied)
    clickhouseSecret.grantRead(analyticsConsumerFn);
    this.eventsStream.grantRead(analyticsConsumerFn);

    // Dashboards Lambda permissions (IMPL-09)
    clickhouseSecret.grantRead(dashboardsFn);
    this.problemsTable.grantReadData(dashboardsFn);
    this.skillsTable.grantReadData(dashboardsFn);

    // Trusted Mountain function permissions (IMPL-16)
    this.trustedMountainTable.grantReadWriteData(trustedMountainFn);

    // API Key system permissions (BETA-03)
    // Authorizer needs read + update (last_used_at fire-and-forget)
    this.apiKeysTable.grantReadWriteData(apiKeyAuthorizerFn);
    // CRUD handlers need read/write
    this.apiKeysTable.grantReadWriteData(createApiKeyFn);
    this.apiKeysTable.grantReadWriteData(listApiKeysFn);
    this.apiKeysTable.grantReadWriteData(deleteApiKeyFn);

    // Decision Engine function permissions (IMPL-10 — ARCH-07 §6.5)
    this.skillsTable.grantReadWriteData(decisionEngineFn);
    gapLogTable.grantReadWriteData(decisionEngineFn);
    configTable.grantReadWriteData(decisionEngineFn);
    this.problemsTable.grantReadWriteData(decisionEngineFn);
    this.eventsStream.grantWrite(decisionEngineFn);
    archiveQueue.grantSendMessages(decisionEngineFn);
    evolveGapQueue.grantSendMessages(decisionEngineFn);

    // -----------------------------------------------------------------------
    // Frontend — existing codevolve-dashboard S3 static website bucket
    // Deploy by syncing frontend/dist to the bucket (skill: deploy-codevolve-cdk-stack)
    // -----------------------------------------------------------------------

    const frontendDir = path.join(__dirname, "../frontend");
    const frontendDist = path.join(frontendDir, "dist");

    if (!fs.existsSync(frontendDist)) {
      execSync("npm run build", { cwd: frontendDir, stdio: "pipe" });
    }

    const frontendBucket = s3.Bucket.fromBucketName(this, "FrontendBucket", "codevolve-dashboard");

    new s3deploy.BucketDeployment(this, "FrontendDeployment", {
      sources: [s3deploy.Source.asset(frontendDist)],
      destinationBucket: frontendBucket,
      prune: true,
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito Community User Pool ID",
    });

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: "http://codevolve-dashboard.s3-website.us-east-2.amazonaws.com/",
      description: "codeVolve dashboard (S3 static website)",
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
      description: "S3 bucket for frontend assets",
    });
  }
}
