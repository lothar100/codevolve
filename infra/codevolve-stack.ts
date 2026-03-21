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
      nonKeyAttributes: ["input_hash", "skill_version", "last_hit_at"],
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

    const defaultLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: lambdaEnvironment,
    };

    // Health check
    const healthFn = new lambda.Function(this, "HealthFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-health",
      handler: "health.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/shared"), {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            "bash",
            "-c",
            "npx esbuild health.ts --bundle --platform=node --target=node22 --outfile=/asset-output/health.js",
          ],
        },
      }),
    } as lambda.FunctionProps);

    // --- Registry Lambda functions (IMPL-02) ---

    const registryBundlingCommand = (entrypoint: string) => [
      "bash",
      "-c",
      `npx esbuild ${entrypoint} --bundle --platform=node --target=node22 --outfile=/asset-output/${entrypoint.replace(".ts", ".js")} --external:@aws-sdk/*`,
    ];

    const createSkillFn = new lambda.Function(this, "CreateSkillFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-create-skill",
      handler: "createSkill.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("createSkill.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const getSkillFn = new lambda.Function(this, "GetSkillFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-get-skill",
      handler: "getSkill.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("getSkill.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const listSkillsFn = new lambda.Function(this, "ListSkillsFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-list-skills",
      handler: "listSkills.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("listSkills.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const listSkillVersionsFn = new lambda.Function(
      this,
      "ListSkillVersionsFn",
      {
        ...defaultLambdaProps,
        functionName: "codevolve-list-skill-versions",
        handler: "listSkillVersions.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../src/registry"),
          {
            bundling: {
              image: lambda.Runtime.NODEJS_22_X.bundlingImage,
              command: registryBundlingCommand("listSkillVersions.ts"),
            },
          },
        ),
      } as lambda.FunctionProps,
    );

    const promoteCanonicalFn = new lambda.Function(this, "PromoteCanonicalFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-promote-canonical",
      handler: "promoteCanonical.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("promoteCanonical.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const createProblemFn = new lambda.Function(this, "CreateProblemFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-create-problem",
      handler: "createProblem.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("createProblem.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const getProblemFn = new lambda.Function(this, "GetProblemFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-get-problem",
      handler: "getProblem.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("getProblem.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const listProblemsFn = new lambda.Function(this, "ListProblemsFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-list-problems",
      handler: "listProblems.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/registry"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: registryBundlingCommand("listProblems.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

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

    // Router: POST /resolve
    // TODO: IMPL-03 — implement resolve handler

    // Execution: POST /execute, POST /execute/chain
    // TODO: IMPL-04 — implement execution handlers

    // Validation: POST /validate/:skill_id
    // TODO: IMPL-05 — implement validation handler

    // Analytics: POST /events
    const emitEventsFn = new lambda.Function(this, "EmitEventsFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-emit-events",
      handler: "emitEvents.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/analytics"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: [
              "bash",
              "-c",
              "npx esbuild emitEvents.ts --bundle --platform=node --target=node22 --outfile=/asset-output/emitEvents.js",
            ],
          },
        },
      ),
    } as lambda.FunctionProps);

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

    const archiveBundlingCommand = (entrypoint: string) => [
      "bash",
      "-c",
      `npx esbuild ${entrypoint} --bundle --platform=node --target=node22 --outfile=/asset-output/${entrypoint.replace(".ts", ".js")} --external:@aws-sdk/*`,
    ];

    const archiveSkillFn = new lambda.Function(this, "ArchiveSkillFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-archive-skill",
      handler: "archiveSkill.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/archive"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: archiveBundlingCommand("archiveSkill.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const unarchiveSkillFn = new lambda.Function(this, "UnarchiveSkillFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-unarchive-skill",
      handler: "unarchiveSkill.handler",
      timeout: cdk.Duration.seconds(60), // longer timeout for Bedrock embedding regeneration
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/archive"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: archiveBundlingCommand("unarchiveSkill.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

    const archiveHandlerFn = new lambda.Function(this, "ArchiveHandlerFn", {
      ...defaultLambdaProps,
      functionName: "codevolve-archive-handler",
      handler: "archiveHandler.handler",
      timeout: cdk.Duration.seconds(300), // matches SQS visibility timeout
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../src/archive"),
        {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            command: archiveBundlingCommand("archiveHandler.ts"),
          },
        },
      ),
    } as lambda.FunctionProps);

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

    // /resolve
    this.api.root.addResource("resolve");
    // POST /resolve

    // /execute
    const executeResource = this.api.root.addResource("execute");
    // POST /execute
    executeResource.addResource("chain");
    // POST /execute/chain

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

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      description: "API Gateway endpoint URL",
    });
  }
}
