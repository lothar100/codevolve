/**
 * Main CDK stack for codeVolve.
 *
 * Creates all DynamoDB tables, Kinesis stream, Lambda functions,
 * and API Gateway routes defined in ARCH-01 and ARCH-02.
 */

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import * as path from "path";

export class CodevolveStack extends cdk.Stack {
  public readonly problemsTable: dynamodb.Table;
  public readonly skillsTable: dynamodb.Table;
  public readonly cacheTable: dynamodb.Table;
  public readonly archiveTable: dynamodb.Table;
  public readonly eventsStream: kinesis.Stream;
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
      CACHE_TABLE: this.cacheTable.tableName,
      ARCHIVE_TABLE: this.archiveTable.tableName,
      EVENTS_STREAM: this.eventsStream.streamName,
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

    // Router: POST /resolve (IMPL-05)
    const resolveFn = new NodejsFunction(this, "ResolveFn", {
      ...commonNodejsProps,
      functionName: "codevolve-resolve",
      entry: path.join(__dirname, "../src/router/resolve.ts"),
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    });

    // Execution: POST /execute, POST /execute/chain (IMPL-06)
    const executeFn = new NodejsFunction(this, "ExecuteFn", {
      ...commonNodejsProps,
      functionName: "codevolve-execute",
      entry: path.join(__dirname, "../src/execution/execute.ts"),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...lambdaEnvironment,
        RUNNER_LAMBDA_PYTHON: "codevolve-runner-python312",
        RUNNER_LAMBDA_NODE: "codevolve-runner-node22",
        SKILLS_TABLE_NAME: this.skillsTable.tableName,
        CACHE_TABLE_NAME: this.cacheTable.tableName,
        KINESIS_STREAM_NAME: this.eventsStream.streamName,
      },
    });

    const executeChainFn = new NodejsFunction(this, "ExecuteChainFn", {
      ...commonNodejsProps,
      functionName: "codevolve-execute-chain",
      entry: path.join(__dirname, "../src/execution/executeChain.ts"),
    });

    // Runner Lambdas — CloudWatch Logs only (no AWS service access)
    const runnerPython312Fn = new lambda.Function(this, "RunnerPython312Fn", {
      functionName: "codevolve-runner-python312",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/runners/python312"),
      ),
    });

    const runnerNode22Fn = new lambda.Function(this, "RunnerNode22Fn", {
      functionName: "codevolve-runner-node22",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler.handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/runners/node22"),
      ),
    });

    // Validation: POST /validate/:skill_id
    // TODO: IMPL-05 — implement validation handler

    // Analytics: POST /events
    const emitEventsFn = new NodejsFunction(this, "EmitEventsFn", {
      ...commonNodejsProps,
      functionName: "codevolve-emit-events",
      entry: path.join(__dirname, "../src/analytics/emitEvents.ts"),
    });

    // GET /analytics/dashboards/:type
    // TODO: IMPL-06 — implement dashboard handler

    // Evolve: POST /evolve
    // TODO: IMPL-07 — implement evolve handler

    // -----------------------------------------------------------------------
    // SQS Queues (IMPL-04 — Archive Mechanism)
    // -----------------------------------------------------------------------

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
        ],
      },
    });

    // GET /health
    const healthResource = this.api.root.addResource("health");
    healthResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(healthFn),
    );

    // Placeholder API resources — methods will be wired in subsequent IMPLs

    // /skills
    const skillsResource = this.api.root.addResource("skills");
    skillsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listSkillsFn),
    );
    skillsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createSkillFn),
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

    // /resolve (IMPL-05)
    const resolveResource = this.api.root.addResource("resolve");
    resolveResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(resolveFn),
    );

    // /execute (IMPL-06)
    const executeResource = this.api.root.addResource("execute");
    executeResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(executeFn),
    );
    const executeChainResource = executeResource.addResource("chain");
    executeChainResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(executeChainFn),
    );

    // /validate
    const validateResource = this.api.root.addResource("validate");
    validateResource.addResource("{skill_id}");
    // POST /validate/:skill_id

    // /events
    const eventsResource = this.api.root.addResource("events");
    eventsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(emitEventsFn),
    );

    // /analytics
    const analyticsResource = this.api.root.addResource("analytics");
    const dashboardsResource = analyticsResource.addResource("dashboards");
    dashboardsResource.addResource("{type}");
    // GET /analytics/dashboards/:type

    // /evolve
    this.api.root.addResource("evolve");
    // POST /evolve

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
      this.cacheTable.grantReadWriteData(fn);
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

    // Execution function permissions (IMPL-06)
    this.skillsTable.grantReadWriteData(executeFn);
    this.cacheTable.grantReadWriteData(executeFn);
    this.eventsStream.grantWrite(executeFn);
    executeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          runnerPython312Fn.functionArn,
          runnerNode22Fn.functionArn,
        ],
      }),
    );

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "API Gateway endpoint URL",
    });
  }
}
