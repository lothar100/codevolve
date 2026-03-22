/**
 * Cosine similarity and boost computation for /resolve skill ranking.
 *
 * Architecture note: both vectors are pre-normalized (Bedrock normalize: true),
 * so cosine similarity reduces to a dot product. We still clamp to [-1, 1]
 * to guard against floating-point rounding artifacts.
 */

const TAG_BOOST_PER_MATCH = 0.05;
const DOMAIN_BOOST_PER_MATCH = 0.10;
const MAX_TOTAL_BOOST = 0.20;

/**
 * Compute cosine similarity between two pre-normalized Float32Array vectors.
 *
 * Both vectors must have the same length. Since vectors are L2-normalized,
 * the result equals their dot product. Result is clamped to [-1, 1].
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // Clamp to guard against float rounding
  return Math.min(1, Math.max(-1, dot));
}

/**
 * Compute metadata boost for a skill candidate.
 *
 * Boost rules:
 *   +0.05 per matching tag (between request tags and skill tags)
 *   +0.10 per matching domain (between request domain and skill domain)
 *   Total boost is capped at +0.20
 *
 * Comparison is exact string match (case-sensitive). The caller is responsible
 * for normalizing tags/domains to lowercase when submitting the request.
 * See docs/vector-search.md §4.2.
 */
export function computeBoost(params: {
  requestTags: string[];
  requestDomain: string[];
  skillTags: string[];
  skillDomain: string[];
}): number {
  const { requestTags, requestDomain, skillTags, skillDomain } = params;

  const requestTagSet = new Set(requestTags);
  const requestDomainSet = new Set(requestDomain);

  let boost = 0;

  for (const tag of skillTags) {
    if (requestTagSet.has(tag)) {
      boost += TAG_BOOST_PER_MATCH;
    }
  }

  for (const domain of skillDomain) {
    if (requestDomainSet.has(domain)) {
      boost += DOMAIN_BOOST_PER_MATCH;
    }
  }

  return Math.min(MAX_TOTAL_BOOST, boost);
}
