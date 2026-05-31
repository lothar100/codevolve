/**
 * TypeScript interfaces for all 5 analytics dashboard API responses.
 * Endpoints: GET /analytics/dashboards/{type}
 */

export interface DashboardMeta {
  degraded?: boolean;
  degraded_reason?: string;
}

export interface SkillLabelFields {
  skill_name?: string;
  problem_name?: string;
  display_name?: string;
}

// --- Dashboard 1: Resolve Performance ---

export interface ResolveLatencyPoint {
  minute: string;
  p50_ms: number;
  p95_ms: number;
}

export interface LatencyHistogramBucket {
  bucket_ms: number;
  request_count: number;
}

export interface HighConfidencePoint {
  minute: string;
  high_confidence_pct: number;
}

export interface LowConfidenceResolve extends SkillLabelFields {
  intent: string;
  confidence: number;
  skill_id: string;
  timestamp: string;
}

export interface ResolvePerformanceDashboard extends DashboardMeta {
  latency_over_time: ResolveLatencyPoint[];
  latency_histogram: LatencyHistogramBucket[];
  high_confidence_pct: number;
  high_confidence_over_time: HighConfidencePoint[];
  success_rate_pct: number;
  low_confidence_resolves: LowConfidenceResolve[];
}

// --- Dashboard 2: Reported Runs & Caching ---

export interface TopSkill extends SkillLabelFields {
  skill_id: string;
  execution_count: number;
}

export interface SkillRepetitionRate extends SkillLabelFields {
  skill_id: string;
  total_executions: number;
  unique_inputs: number;
  input_repeat_rate: number;
}

export interface CacheRatePoint {
  minute: string;
  cache_hits: number;
  cache_misses: number;
  hit_rate_pct: number;
}

export interface RepetitionRatePoint {
  minute?: string;
  hour?: string;
  input_repeat_rate_pct?: number;
  intent_repetition_rate_pct?: number;
}

export interface ExecutionLatencyPoint {
  minute: string;
  p50_ms: number;
  p95_ms: number;
}

export interface CacheCandidate extends SkillLabelFields {
  skill_id: string;
  execution_count: number;
  unique_inputs: number;
  input_repeat_rate: number;
  p95_ms: number;
}

export interface ExecutionCachingDashboard extends DashboardMeta {
  top_skills: TopSkill[];
  repetition_rates: SkillRepetitionRate[];
  cache_hit_rate_pct?: number;
  intent_repetition_rate_pct?: number;
  cache_rate_over_time?: CacheRatePoint[];
  repetition_rate_over_time?: RepetitionRatePoint[];
  execution_latency_over_time: ExecutionLatencyPoint[];
  cache_candidates: CacheCandidate[];
}

// --- Dashboard 3: Skill Quality ---

export interface SkillPassRate extends SkillLabelFields {
  skill_id: string;
  passed: number;
  failed: number;
  pass_rate_pct: number;
}

export interface SkillConfidencePoint extends SkillLabelFields {
  skill_id: string;
  hour: string;
  avg_confidence: number;
  min_confidence: number;
}

export interface SkillFailureRate extends SkillLabelFields {
  skill_id: string;
  total_executions: number;
  failures: number;
  failure_rate_pct: number;
}

export interface CompetingImplementation {
  intent: string;
  competing_skills: string[];
  num_competitors: number;
  best_confidence: number;
  worst_confidence: number;
}

export interface ConfidenceDegradation extends SkillLabelFields {
  skill_id: string;
  prior_conf: number;
  recent_conf: number;
  confidence_delta: number;
}

export interface SkillQualityDashboard extends DashboardMeta {
  test_pass_rates: SkillPassRate[];
  confidence_over_time: SkillConfidencePoint[];
  failure_rates: SkillFailureRate[];
  competing_implementations: CompetingImplementation[];
  confidence_degradation: ConfidenceDegradation[];
}

// --- Dashboard 4: Evolution / Gap ---

export interface UnresolvedIntent {
  intent: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}

export interface LowConfidenceIntent extends SkillLabelFields {
  intent: string;
  skill_id: string;
  occurrences: number;
  avg_confidence: number;
}

export interface LowConfidenceVolumePoint {
  hour: string;
  low_confidence_count: number;
  total_resolves: number;
  low_confidence_pct: number;
}

export interface FailedExecution extends SkillLabelFields {
  skill_id: string;
  total_executions: number;
  failures: number;
  failure_rate_pct: number;
}

export interface DomainCoverageGap {
  domain: string;
  unique_intents: number;
  unresolved_count: number;
  low_confidence_count: number;
  execution_failures: number;
}

export interface EvolveEvent {
  intent: string;
  fail_count: number;
  first_failure: string;
  latest_failure: string;
}

export interface EvolutionGapDashboard extends DashboardMeta {
  unresolved_intents: UnresolvedIntent[];
  low_confidence_intents: LowConfidenceIntent[];
  low_confidence_volume: LowConfidenceVolumePoint[];
  failed_executions: FailedExecution[];
  domain_coverage_gaps: DomainCoverageGap[];
  evolve_pipeline: EvolveEvent[];
}

// --- Dashboard 5: Agent Behavior ---

export interface ConversionFunnelPoint {
  hour: string;
  resolves: number;
  executes: number;
  conversion_rate_pct: number;
}

export interface RepeatedResolve {
  intent: string;
  resolve_count: number;
  distinct_skills_returned: number;
  avg_confidence: number;
}

export interface AbandonedExecution {
  intent: string;
  resolve_count: number;
  execute_count: number;
  abandoned_count: number;
}

export interface SkillChainPattern {
  from_skill: string;
  to_skill: string;
  from_skill_name?: string;
  from_problem_name?: string;
  from_display_name?: string;
  to_skill_name?: string;
  to_problem_name?: string;
  to_display_name?: string;
  chain_count: number;
}

export interface HourlyUsagePoint {
  day_of_week: number;
  hour_of_day: number;
  event_count: number;
}

export interface AgentBehaviorDashboard extends DashboardMeta {
  total_resolves: number;
  total_executes: number;
  conversion_rate_pct: number;
  conversion_over_time: ConversionFunnelPoint[];
  repeated_resolves: RepeatedResolve[];
  abandoned_executions: AbandonedExecution[];
  skill_chain_patterns: SkillChainPattern[];
  hourly_usage: HourlyUsagePoint[];
}

// --- Generic ---

export type DashboardType =
  | "resolve-performance"
  | "execution-caching"
  | "skill-quality"
  | "evolution-gap"
  | "agent-behavior";

export type DashboardData =
  | ResolvePerformanceDashboard
  | ExecutionCachingDashboard
  | SkillQualityDashboard
  | EvolutionGapDashboard
  | AgentBehaviorDashboard;
