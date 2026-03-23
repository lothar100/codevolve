# codeVolve — Architecture

> Maintained by Quimby. Updated after each architectural change. Source of truth for system structure.

---

## System Overview

codeVolve is an AI-native registry of programming problems and solutions ("skills"). The platform is designed primarily for AI agent consumption — agents resolve intents to canonical skills, execute them, and contribute improvements back. The feedback loop drives continuous improvement: more usage → better analytics → better routing → less agentic computation.

---

## Request Flow

```
Client / Agent
    │
    ├── POST /resolve    → Skill Router     (Lambda + OpenSearch Serverless + DynamoDB tag filter)
    │                                        Returns: { skill_id, confidence, skill }
    │
    ├── POST /execute    → Execution Layer  (Lambda + ElastiCache/DynamoDB cache + sandboxed runner Lambda)
    │                                        Returns: { outputs, latency_ms, cache_hit }
    │
    ├── POST /validate   → Validation Layer (Lambda + per-language Docker test runner)
    │                                        Returns: { pass_rate, test_results, confidence_score }
    │
    ├── POST /evolve     → Evolution Layer  (Lambda + SQS + Claude API — async)
    │                                        Returns: 202 Accepted, { job_id }
    │
    └── All handlers → Kinesis Data Stream
                              └── Analytics Consumer Lambda
                                        └── ClickHouse / BigQuery
                                                  └── Decision Engine Lambda (EventBridge, scheduled)
                                                            ├── auto-cache trigger → ElastiCache
                                                            ├── optimization flag → DynamoDB
                                                            ├── gap detection → SQS GapQueue → /evolve
                                                            └── archive evaluation → SQS ArchiveQueue → archive Lambda
```

---

## AWS Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `codevolve-problems` | DynamoDB | Problem records |
| `codevolve-skills` | DynamoDB | Skill records |
| `codevolve-cache` | DynamoDB (TTL) or ElastiCache | Input/output cache |
| `codevolve-archive` | DynamoDB | Archived problems and skills |
| OpenSearch Serverless | OpenSearch | Skill embeddings for /resolve |
| Kinesis Data Stream | Kinesis | Analytics event pipeline |
| ClickHouse / BigQuery | Analytics store | All analytics events (separate from primary DB) |
| SQS GapQueue | SQS | Unresolved intents queued for /evolve |
| SQS ArchiveQueue | SQS | Archive decisions queued for archive Lambda |
| EventBridge | Scheduler | Triggers Decision Engine Lambda every 5 minutes |
| Bedrock (Titan Embeddings v2) | AI | Embedding generation for skills |
| Claude API (claude-sonnet-4-6) | AI | Skill generation in /evolve only |

---

## Lambda Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `registry-handler` | API Gateway | Skill + Problem CRUD |
| `router-handler` | API Gateway | /resolve |
| `execution-handler` | API Gateway | /execute |
| `validation-handler` | API Gateway | /validate |
| `evolve-handler` | API Gateway + SQS | /evolve (async) |
| `archive-handler` | SQS (ArchiveQueue) | Archive/unarchive skills and problems |
| `analytics-consumer` | Kinesis | Events → ClickHouse/BigQuery |
| `decision-engine` | EventBridge (5-min) | Auto-cache, optimization flags, gap detection, archive evaluation |
| `skill-runner-python` | Lambda (invoked by execution-handler) | Sandboxed Python skill execution |
| `skill-runner-node` | Lambda (invoked by execution-handler) | Sandboxed Node.js skill execution |

---

## Source Layout

```
src/
  registry/       ← Skill + Problem CRUD (DynamoDB)
  router/         ← /resolve (OpenSearch + tag filter, no LLM)
  execution/      ← /execute (cache + sandboxed runner invocation)
  validation/     ← /validate (test runner)
  analytics/      ← dashboard endpoints + analytics consumer
  evolve/         ← /evolve (Claude API — only LLM usage in codebase)
  archive/        ← archive mechanism
  shared/         ← types, DynamoDB client, Kinesis emitter, zod schemas, errors
infra/            ← AWS CDK stacks and constructs
tests/            ← Jest unit + integration tests (mirrors src/ structure)
docs/             ← Architecture, API contracts, design docs, decisions
tasks/            ← Task tracker and lessons
```

---

## Hard Architectural Rules

1. Analytics events → Kinesis only. Never write analytics to DynamoDB primary tables.
2. LLM calls (Claude API) → `src/evolve/` only. Never in `/resolve` or `/execute` paths.
3. Skill execution → sandboxed Lambda only. No network access, no filesystem writes.
4. Archive → `status: "archived"` flag only. Never hard-delete records.
5. ClickHouse/BigQuery → append-only. No analytics record deletion, even for archived skills.
6. Canonical promotion → requires `confidence >= 0.85` AND all tests passing.
7. `/resolve` → pre-computed embeddings only. No real-time embedding at query time.

---

*Last updated: 2026-03-20 — initial bootstrap*

### Overview

Edge caching is a two-layer system: a CloudFront distribution as the global front door, and API Gateway stage-level response caching as a second layer. Together they shield DynamoDB reads and Lambda invocations from repetitive GET traffic. POST endpoints and all write paths bypass caching entirely.

### CloudFront Distribution Topology

```
Internet / AI Agents
        │
        ▼
  CloudFront Distribution (PriceClass_100)
  codevolve.example.com  (custom domain, Phase 5)
        │
        ├── /mountain*  ─────────────────────────────────────────────────────────────────────────┐
        │   (static frontend assets)                                                              │
        │   Cache TTL: 365 days (content-hashed filenames)                                       │
        │   Cache key: URI only (no query string, no headers)                                     ▼
        │                                                                               S3 Bucket (mountain-frontend)
        │                                                                               OAC — SigV4 signed
        │
        ├── GET /skills*  ─────────────────────┐
        │   Cache TTL: 60s (max-age=60, swr=30) │
        │   Cache key: URI + query string        │
        │   Vary: Accept, Accept-Language        │
        │                                        │
        ├── GET /problems*  ─────────────────────┤
        │   Cache TTL: 60s                       │
        │   Cache key: URI + query string        │     API Gateway Regional Endpoint
        │   Vary: Accept, Accept-Language        ├──→  (us-east-2)
        │                                        │     https://qrxttojvni.execute-api
        ├── GET /analytics/dashboards*  ─────────┤           .us-east-2.amazonaws.com/v1
        │   Cache TTL: 300s (max-age=300, swr=60)│
        │   Cache key: URI + query string        │         │
        │   Vary: Accept, Accept-Language        │         ▼
        │                                        │    API GW Stage Cache (GET only)
        ├── POST /resolve  ─────────────────────►│    TTL: 60s, keyed on path + query string
        │   NO CACHE — pass-through              │
        │                                        │         │
        ├── POST /execute  ─────────────────────►│         ▼
        │   NO CACHE — pass-through              │    Lambda Functions
        │                                        │         │
        └── POST /skills, POST /problems,        │         ▼
            POST /skills/:id/promote-canonical,  │    DynamoDB
            POST /evolve, POST /validate, etc.   │
            NO CACHE — pass-through             ─┘
```

### Cache Behavior Table

| Path Pattern | Method | CloudFront TTL | API GW Cache | Cache Key | Response Headers |
|---|---|---|---|---|---|
| `/mountain*` | GET | 365 days | No | URI only | `Cache-Control: public, max-age=31536000, immutable` |
| `/skills` | GET | 60s | Yes (60s) | URI + full query string | `Cache-Control: public, max-age=60, stale-while-revalidate=30` |
| `/skills/{id}` | GET | 60s | Yes (60s) | URI + path param | `Cache-Control: public, max-age=60, stale-while-revalidate=30` |
| `/skills/{id}/versions` | GET | 60s | Yes (60s) | URI + path param | `Cache-Control: public, max-age=60, stale-while-revalidate=30` |
| `/problems` | GET | 60s | Yes (60s) | URI + full query string | `Cache-Control: public, max-age=60, stale-while-revalidate=30` |
| `/problems/{id}` | GET | 60s | Yes (60s) | URI + path param | `Cache-Control: public, max-age=60, stale-while-revalidate=30` |
| `/analytics/dashboards/{type}` | GET | 300s | No | URI + path param | `Cache-Control: public, max-age=300, stale-while-revalidate=60` |
| `/health` | GET | No cache | No | — | `Cache-Control: no-store` |
| `/resolve` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/execute` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/execute/chain` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/validate/{skill_id}` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/skills` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/skills/{id}/promote-canonical` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/skills/{id}/archive` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/skills/{id}/unarchive` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/problems` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/events` | POST | No cache | No | — | `Cache-Control: no-store` |
| `/evolve` | POST | No cache | No | — | `Cache-Control: no-store` |

Notes on cache key policy (applied to all cached GET behaviors):
- **Included in cache key:** URI path, query string parameters (all), `Accept` header, `Accept-Language` header.
- **Excluded from cache key:** Cookies (none are set by the API), `Authorization` header (API is currently public-read; add Authorization to cache key if per-user auth is introduced in Phase 5 IMPL-16), `X-Request-Id`, `X-Agent-Id` (request-tracking headers must never be part of the cache key — they are unique per request and would reduce cache effectiveness to zero).

### CloudFront Cache Behaviors (ordered by precedence)

CloudFront evaluates path patterns in the order listed. The first matching behavior wins.

```
Priority  Path Pattern                       TTL      Origin
--------  ---------------------------------  -------  --------------------------
1         /mountain*                         365 days S3 (OAC)
2         /analytics/dashboards/*            300s     API Gateway Regional
3         /skills*                           60s      API Gateway Regional
4         /problems*                         60s      API Gateway Regional
5         /* (default)                       0s       API Gateway Regional
          (POST pass-through, no cache)
```

The default behavior (priority 5) applies to all POST endpoints, `/resolve`, `/execute`, `/validate`, `/events`, `/evolve`, and any path not matched above. TTL is 0 and `min-ttl=0, default-ttl=0, max-ttl=0` is enforced so CloudFront never caches these responses regardless of the origin's Cache-Control header.

### Cache Key Policy Details

For behaviors 2–4 above, the cache key policy is:

```
CacheKeyPolicy:
  EnableAcceptEncodingGzip: true
  EnableAcceptEncodingBrotli: true
  HeadersConfig:
    HeaderBehavior: whitelist
    Headers: [Accept, Accept-Language]
  QueryStringsConfig:
    QueryStringBehavior: all          # include all query params (language, domain, tag, status, limit, cursor)
  CookiesConfig:
    CookieBehavior: none              # no cookies on this API
```

### Response Headers Policy

Applied to all cached GET behaviors (2–4):

```
ResponseHeadersPolicy:
  CustomHeadersConfig:
    - Header: Cache-Control
      Value: "public, max-age=60, stale-while-revalidate=30"   # overridden per-behavior by origin
      Override: false    # do not override if Lambda sets its own Cache-Control
  SecurityHeadersConfig:
    StrictTransportSecurity:
      AccessControlMaxAgeSec: 31536000
      IncludeSubdomains: true
    ContentTypeOptions: enabled          # X-Content-Type-Options: nosniff
    FrameOptions: DENY                   # X-Frame-Options: DENY
    XSSProtection:
      Protection: true
      ModeBlock: true
```

For the `/mountain*` behavior (static frontend):

```
ResponseHeadersPolicy:
  CustomHeadersConfig:
    - Header: Cache-Control
      Value: "public, max-age=31536000, immutable"
      Override: true
```

### API Gateway Stage-Level Response Cache

Enabled on the `v1` stage for all GET methods that benefit from a second caching layer. CloudFront handles the global edge; API GW caching handles the warm path before Lambda.

```
CachingEnabled: true
CacheTtlInSeconds: 60
CacheDataEncrypted: false           # no PII in skill/problem records
CacheClusterSize: 0.5               # 0.5 GB — sufficient for registry responses at Phase 5 scale
                                     # upgrade to 1.6 GB if hit rate < 60% after 30 days of traffic

Cache key per endpoint:
  GET /skills                       → method.request.querystring.language +
                                      method.request.querystring.domain +
                                      method.request.querystring.tag +
                                      method.request.querystring.status +
                                      method.request.querystring.limit +
                                      method.request.querystring.cursor
  GET /skills/{id}                  → method.request.path.id
  GET /skills/{id}/versions         → method.request.path.id
  GET /problems                     → method.request.querystring.domain +
                                      method.request.querystring.status +
                                      method.request.querystring.limit +
                                      method.request.querystring.cursor
  GET /problems/{id}                → method.request.path.id
```

POST methods, `/resolve`, `/execute`, `/validate`, `/events`, `/evolve`: caching disabled.

### Cache Invalidation Strategy

Writes must invalidate stale edge cache immediately. The pattern is: Lambda handler completes its DynamoDB write, then calls the CloudFront CreateInvalidation API before returning the response. The invalidation is asynchronous at CloudFront (propagates to edge within 5–30 seconds) but the API call itself completes within ~100ms, which is acceptable within a Lambda 30-second timeout.

Tag-based invalidation is used in preference to path-based invalidation to minimize invalidation cost (path-based charges $0.005 per path beyond 1,000/month free tier; tag-based counts as one invalidation regardless of how many cached paths match the tag).

#### Invalidation Trigger Table

| Write Operation | Lambda | CloudFront Invalidation | Tag Used |
|---|---|---|---|
| `POST /skills` (create) | `createSkillFn` | `/skills*` | `skills` |
| `POST /skills/:id/promote-canonical` | `promoteCanonicalFn` | `/skills/:id`, `/problems/*` | `skills`, `problems` |
| `POST /skills/:id/archive` | `archiveSkillFn` | `/skills/:id`, `/problems/*` | `skills`, `problems` |
| `POST /skills/:id/unarchive` | `unarchiveSkillFn` | `/skills/:id`, `/problems/*` | `skills`, `problems` |
| `POST /problems` (create) | `createProblemFn` | `/problems*` | `problems` |
| Decision Engine — archive evaluation | `decisionEngineFn` | `/skills/*`, `/problems/*` | `skills`, `problems` |
| Decision Engine — optimization flag | `decisionEngineFn` | `/skills/*` | `skills` |

CloudFront resource tags are applied at distribution creation and mapped to cached paths via a CDK custom resource (see CDK Constructs section below). The `CloudFrontInvalidation` CDK custom resource pattern is used for automated invalidations from Lambda.

#### API Gateway Cache Invalidation

API Gateway does not support tag-based invalidation. When a CloudFront invalidation is triggered, the corresponding API GW resource cache is also flushed via the API GW `flushStageAuthorizersCache` / per-resource `Cache-Control: max-age=0` header on the next request. In practice, since CloudFront and API GW caches share the same 60-second TTL, the API GW cache will self-expire within 60 seconds of a write. The API GW cache is an opportunistic layer and its occasional staleness within the TTL window is acceptable.

For critical invalidations (promote-canonical, archive), the Lambda handler sets `Cache-Control: no-cache` on the invalidation request to API GW's own cache flush API:

```
DELETE /restapis/{api_id}/stages/{stage_name}/cache/data
```

This flushes the entire stage cache. It is coarser than per-resource flush but safe because the full flush takes less than 1 second and the stage cache rebuilds quickly from DynamoDB.

### DynamoDB Read-Through Cache for Hot Skills

The execution cache (`codevolve-cache`) already handles `(skill_id, input_hash) → output` for repeated skill executions. A separate concern is the hot read path for `GET /skills/:id` — the skill record itself, not an execution output. At high agent traffic, a single canonical skill may receive thousands of reads per minute.

#### Decision: DynamoDB TTL Read-Through Cache (`codevolve-read-cache`)

Add a `codevolve-read-cache` DynamoDB table for skill and problem record caching:

```
Table: codevolve-read-cache
PK: entity_id (String)           ← skill_id or problem_id
Attributes:
  entity_type   String           ← "skill" | "problem"
  payload       String           ← JSON-serialized skill or problem record
  ttl           Number           ← Unix timestamp, now + 300 seconds (5-minute TTL)
  cached_at     String           ← ISO8601
  version_number Number          ← skill version number at time of caching (for freshness check)

TTL attribute: ttl (DynamoDB TTL enabled)
Billing: PAY_PER_REQUEST
RemovalPolicy: DESTROY
```

Read flow for `GET /skills/:id`:

```
1. Check codevolve-read-cache for entity_id = skill_id
2. HIT: return payload (if version_number matches request or no version requested)
   MISS: read from codevolve-skills (primary table)
         write result to codevolve-read-cache with TTL = now + 300s
         return result
```

Cache warming on canonical promotion: when `POST /skills/:id/promote-canonical` completes, the `promoteCanonicalFn` writes the updated skill record to `codevolve-read-cache` immediately. This pre-populates the cache before the next agent reads the newly promoted skill, avoiding a cold read.

Cache invalidation on write: any Lambda that updates a skill (archive, unarchive, promote-canonical, update confidence) deletes the corresponding `codevolve-read-cache` entry via `DeleteItem` before returning. This ensures the next read is fresh. The delete is synchronous within the Lambda handler.

When to use `codevolve-read-cache` vs primary table:

| Condition | Action |
|---|---|
| Read cache HIT and skill not archived and version matches | Return from cache, skip primary DynamoDB read |
| Read cache MISS | Read from primary, write to cache |
| Skill was recently written (write just completed in same request) | Always read from primary (no cache write in same request) |
| Skill is archived | Do not cache. Archived skills are excluded from routing/search and read infrequently enough that caching adds no value |
| Request includes `?bypass_cache=true` | Skip read cache, read from primary, do not update cache |

The `?bypass_cache=true` query parameter is documented in `docs/api.md` as a debugging aid, not a production-path feature. CloudFront passes query strings through, so this parameter also bypasses CloudFront's cache (since it changes the cache key) and API GW's cache (which keys on query string parameters).

Note: this read-through cache is **distinct** from `codevolve-cache` (which caches skill execution outputs, keyed on `(skill_id, input_hash)`). The two tables serve different purposes and must not be merged.

### CDK Constructs Required for IMPL-17

The following CDK constructs and packages are required to implement this design:

#### New NPM Packages

```
aws-cdk-lib/aws-cloudfront          (already in aws-cdk-lib — no new package)
aws-cdk-lib/aws-cloudfront-origins  (already in aws-cdk-lib — no new package)
aws-cdk-lib/aws-s3                  (already in aws-cdk-lib — no new package)
```

No additional npm packages are required. All CloudFront, S3, and CloudFront Origins constructs are included in `aws-cdk-lib`.

#### New CDK Constructs

```typescript
// 1. S3 Bucket — mountain visualization frontend
const mountainFrontendBucket = new s3.Bucket(this, 'MountainFrontendBucket', {
  bucketName: 'codevolve-mountain-frontend',
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  autoDeleteObjects: false,
  versioned: false,
  encryption: s3.BucketEncryption.S3_MANAGED,
});

// 2. Origin Access Control (OAC) for S3
//    CDK L2 support for OAC is via CfnOriginAccessControl (L1)
const oac = new cloudfront.CfnOriginAccessControl(this, 'MountainOAC', {
  originAccessControlConfig: {
    name: 'codevolve-mountain-oac',
    originAccessControlOriginType: 's3',
    signingBehavior: 'always',
    signingProtocol: 'sigv4',
  },
});

// 3. CloudFront Distribution
const distribution = new cloudfront.Distribution(this, 'CodevolveDistribution', {
  comment: 'codeVolve API + mountain frontend',
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
  // Default behavior — API Gateway (POST pass-through, no cache)
  defaultBehavior: {
    origin: new cloudfrontOrigins.HttpOrigin(
      `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`,
      { originPath: '/v1' }
    ),
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
  },
  additionalBehaviors: {
    // GET /skills* — 60s cache
    '/skills*': {
      origin: new cloudfrontOrigins.HttpOrigin(
        `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`,
        { originPath: '/v1' }
      ),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(this, 'SkillsCachePolicy', {
        cachePolicyName: 'codevolve-skills-60s',
        defaultTtl: cdk.Duration.seconds(60),
        minTtl: cdk.Duration.seconds(0),
        maxTtl: cdk.Duration.seconds(90),
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept', 'Accept-Language'),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }),
    },
    // GET /problems* — 60s cache
    '/problems*': {
      origin: new cloudfrontOrigins.HttpOrigin(
        `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`,
        { originPath: '/v1' }
      ),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(this, 'ProblemsCachePolicy', {
        cachePolicyName: 'codevolve-problems-60s',
        defaultTtl: cdk.Duration.seconds(60),
        minTtl: cdk.Duration.seconds(0),
        maxTtl: cdk.Duration.seconds(90),
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept', 'Accept-Language'),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }),
    },
    // GET /analytics/dashboards/* — 300s cache
    '/analytics/dashboards/*': {
      origin: new cloudfrontOrigins.HttpOrigin(
        `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`,
        { originPath: '/v1' }
      ),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(this, 'DashboardsCachePolicy', {
        cachePolicyName: 'codevolve-dashboards-300s',
        defaultTtl: cdk.Duration.seconds(300),
        minTtl: cdk.Duration.seconds(0),
        maxTtl: cdk.Duration.seconds(360),
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Accept', 'Accept-Language'),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }),
    },
    // /mountain* — 365-day cache (immutable content-hashed assets)
    '/mountain*': {
      origin: new cloudfrontOrigins.S3Origin(mountainFrontendBucket),
      // OAC is attached at the L1 level post-construct via escape hatch:
      // (distribution.node.defaultChild as cloudfront.CfnDistribution)
      //   .distributionConfig.origins[n].originAccessControlId = oac.attrId
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
  },
});

// 4. Grant CloudFront OAC read access to S3 bucket
mountainFrontendBucket.addToResourcePolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject'],
  principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
  resources: [mountainFrontendBucket.arnForObjects('*')],
  conditions: {
    StringEquals: {
      'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    },
  },
}));

// 5. CloudFrontInvalidation — custom resource pattern for Lambda-triggered invalidations
//    Implemented via a helper Lambda (codevolve-cf-invalidator) with permission to call
//    cloudfront:CreateInvalidation on the distribution ARN.
//    Each write Lambda receives the distribution ID as an environment variable
//    (CLOUDFRONT_DISTRIBUTION_ID) and calls the helper or directly invokes
//    cloudfront:CreateInvalidation using its own role.
const cfInvalidatorPolicy = new iam.PolicyStatement({
  actions: ['cloudfront:CreateInvalidation'],
  resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
});
// Grant to write Lambdas: createSkillFn, promoteCanonicalFn, archiveSkillFn,
// unarchiveSkillFn, createProblemFn, decisionEngineFn (IMPL-10)

// 6. codevolve-read-cache DynamoDB table
const readCacheTable = new dynamodb.Table(this, 'ReadCacheTable', {
  tableName: 'codevolve-read-cache',
  partitionKey: { name: 'entity_id', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  timeToLiveAttribute: 'ttl',
});
```

#### Lambda Environment Variable Additions

Every write Lambda that triggers invalidation must receive:

```
CLOUDFRONT_DISTRIBUTION_ID: distribution.distributionId
READ_CACHE_TABLE: readCacheTable.tableName
```

#### CDK Stack Outputs (new)

```typescript
new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
  value: distribution.distributionId,
  description: 'CloudFront Distribution ID — needed for cache invalidation',
});
new cdk.CfnOutput(this, 'CloudFrontDomainName', {
  value: distribution.distributionDomainName,
  description: 'CloudFront domain — use as API base URL in Phase 5',
});
new cdk.CfnOutput(this, 'MountainFrontendBucketName', {
  value: mountainFrontendBucket.bucketName,
  description: 'S3 bucket for mountain visualization frontend deployment',
});
```

### Price Estimate (PriceClass_100, moderate traffic)

| Component | Cost Driver | Estimated Monthly Cost |
|---|---|---|
| CloudFront — data transfer | 10 GB/month egress | ~$0.85 |
| CloudFront — HTTPS requests | 1M GET requests/month | ~$0.75 |
| CloudFront — invalidations | 500 invalidations/month (tag-based counts as 1 each) | ~$2.50 (after 1,000 free) |
| API GW — response cache | 0.5 GB cache cluster | ~$14.40 |
| DynamoDB read-cache table | Minimal reads (mostly CloudFront hits) | ~$0.50 |
| S3 — frontend storage | 50 MB static assets | ~$0.01 |
| **Total** | | **~$19/month at moderate traffic** |

At high agent traffic (100M GET requests/month), CloudFront costs scale to ~$75/month while DynamoDB read costs fall proportionally as cache hit rate rises. The net effect is cost-neutral or cost-reducing above ~5M requests/month compared to uncached DynamoDB-direct serving.

---

## Hard Architectural Rules

1. Analytics events → Kinesis only. Never write analytics to DynamoDB primary tables.
2. LLM calls (Claude API) → `src/evolve/` only. Never in `/resolve` or `/execute` paths.
3. Skill execution → sandboxed Lambda only. No network access, no filesystem writes.
4. Archive → `status: "archived"` flag only. Never hard-delete records.
5. ClickHouse/BigQuery → append-only. No analytics record deletion, even for archived skills.
6. Canonical promotion → requires `confidence >= 0.85` AND all tests passing.
7. `/resolve` → pre-computed embeddings only. No real-time embedding at query time.
8. Edge cache → never cache POST endpoints, `/resolve`, `/execute`, `/validate`, `/events`, or `/evolve`. Cache only GET endpoints with explicit TTLs documented in the cache behavior table above.
9. Cache invalidation → always synchronously initiate CloudFront invalidation within the write Lambda handler before returning the response. Never allow a write to complete without triggering invalidation.

---

*Last updated: 2026-03-22 — ARCH-09 edge caching design added (ADR-010)*
