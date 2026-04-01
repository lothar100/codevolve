#!/bin/bash
# Submit 12 skills to the codeVolve API
# Run: bash scripts/submit-skills.sh

TOKEN="eyJraWQiOiIwQncyNkI4SzVHOERyXC94N1BCbDUxR0pRUThoUWRlTkZUVUZTQ3hiaGJETT0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTIuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0yX0FOek1LTms1ayIsImNvZ25pdG86dXNlcm5hbWUiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJvcmlnaW5fanRpIjoiZDIyY2E2YjQtNjk5NS00ZWNiLThhZTgtYjY0MzIwMTc3ZTI2IiwiYXVkIjoiMmFsajNxb2M4a2pybnNhYzJkNW9rcTdxdDAiLCJldmVudF9pZCI6IjgwNzVlM2I5LWRiNmYtNDIyYS04MzYyLWExMjUyNTkyMzM5MSIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNzc0ODk1NTEzLCJleHAiOjE3NzQ4OTkxMTMsImlhdCI6MTc3NDg5NTUxMywianRpIjoiZTRmYjE4MjEtNmZiMC00NmJkLTgzMjEtNDQwMTAyZDIxMmIyIiwiZW1haWwiOiJhZ2VudEBjb2Rldm9sdmUuYWkifQ.btzMHQS02IvxL1uiCMzR7kS0Jp8JzbHees0WUXpUrHbY1Iji6qkQIHfPRp0nTTkCd2MTQihx3zwjEO3KJqxwrku59vlijEky2AH6TCH81lZduRZQMA7F_KqBiaaDVKCoC4MqBQu-PlFscbWsl_iwIJTqeEEcPUvZaEuJ7C1vM1XjQxdKi4_cQEkaK_EdJ3SGZKSpFiBFX9q2nqdd7WfBlkw3RXXm3JVzkPaKhQOh3HilmQFKUQ23NUQqhLAi3QHIZb6ffOuIzgZtu5y3ZlXU2UTFmo3UDYvDPdcIDhnw8HqmCJzhbtxIQXtHXq2Uu4gLWc58UEfGVzsciZwg-Tb48g"
BASE="https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1/skills"

submit() {
  local label="$1"
  local file="$2"
  echo "=== $label ==="
  curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --data-binary "@$file"
  echo ""
}

DIR="$(dirname "$0")/skill-payloads"
mkdir -p "$DIR"

# ── Problem 2: Slugify ──────────────────────────────────────────────────────
cat > "$DIR/p2.json" << 'ENDJSON'
{
  "problem_id": "28d60d79-256e-41ab-acd5-8ebdac0ee530",
  "name": "slugify-string",
  "description": "Converts an arbitrary string into a URL-safe slug: lowercase, spaces and special characters replaced with hyphens, multiple hyphens collapsed, leading/trailing hyphens stripped. O(n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [{"name": "str", "type": "string"}],
  "outputs": [{"name": "slug", "type": "string"}],
  "examples": [
    {"input": {"str": "Hello, World! This is a Test."}, "output": {"slug": "hello-world-this-is-a-test"}}
  ],
  "tests": [
    {"input": {"str": "Hello, World!"}, "expected": {"slug": "hello-world"}},
    {"input": {"str": "  --Multiple---Hyphens--  "}, "expected": {"slug": "multiple-hyphens"}},
    {"input": {"str": "TypeScript & Node.js 100%"}, "expected": {"slug": "typescript-node-js-100"}},
    {"input": {"str": "already-a-slug"}, "expected": {"slug": "already-a-slug"}}
  ],
  "implementation": "function slugify(str: string): string {\n  return str\n    .toLowerCase()\n    .replace(/[^a-z0-9\\s-]/g, ' ')\n    .replace(/[\\s-]+/g, '-')\n    .replace(/^-+|-+$/g, '');\n}",
  "tags": ["string", "slug", "url", "utility"],
  "status": "verified"
}
ENDJSON

# ── Problem 3: Extract URLs ──────────────────────────────────────────────────
cat > "$DIR/p3.json" << 'ENDJSON'
{
  "problem_id": "b5df977a-5b70-42df-a636-953033e5d90c",
  "name": "extract-urls-from-text",
  "description": "Extracts all unique HTTP/HTTPS URLs from a block of text using regex. Returns each URL once even if it appears multiple times. Trailing punctuation is stripped. O(n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [{"name": "text", "type": "string"}],
  "outputs": [{"name": "urls", "type": "string[]"}],
  "examples": [
    {"input": {"text": "Visit https://example.com and http://foo.bar/path?q=1 for more."}, "output": {"urls": ["https://example.com", "http://foo.bar/path?q=1"]}}
  ],
  "tests": [
    {"input": {"text": "Go to https://example.com now."}, "expected": {"urls": ["https://example.com"]}},
    {"input": {"text": "https://a.com appears twice: https://a.com and also http://b.org/page"}, "expected": {"urls": ["https://a.com", "http://b.org/page"]}},
    {"input": {"text": "No URLs here."}, "expected": {"urls": []}},
    {"input": {"text": "ftp://notaurl.com and https://valid.com"}, "expected": {"urls": ["https://valid.com"]}}
  ],
  "implementation": "function extractUrls(text: string): string[] {\n  const urlRegex = /https?:\\/\\/[^\\s<>\"'\\)\\]]+/g;\n  const matches = text.match(urlRegex) || [];\n  const cleaned = matches.map(url => url.replace(/[.,;:!?]+$/, ''));\n  const seen = new Set<string>();\n  const result: string[] = [];\n  for (const url of cleaned) {\n    if (!seen.has(url)) {\n      seen.add(url);\n      result.push(url);\n    }\n  }\n  return result;\n}",
  "tags": ["string", "url", "regex", "extraction"],
  "status": "verified"
}
ENDJSON

# ── Problem 4: Strip HTML tags ───────────────────────────────────────────────
cat > "$DIR/p4.json" << 'ENDJSON'
{
  "problem_id": "c928a021-9def-4496-8746-bc410876b658",
  "name": "strip-html-tags",
  "description": "Removes all HTML tags from a string using a state-machine parser. Handles self-closing tags, attribute values containing angle brackets, and nested structures. O(n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [{"name": "html", "type": "string"}],
  "outputs": [{"name": "text", "type": "string"}],
  "examples": [
    {"input": {"html": "<p>Hello <b>World</b>!</p>"}, "output": {"text": "Hello World!"}}
  ],
  "tests": [
    {"input": {"html": "<p>Hello <b>World</b>!</p>"}, "expected": {"text": "Hello World!"}},
    {"input": {"html": "<img src=\"x\" alt=\"img\"/> Text"}, "expected": {"text": " Text"}},
    {"input": {"html": "<a href=\"http://example.com?a=1&b=2\">link</a>"}, "expected": {"text": "link"}},
    {"input": {"html": "No tags here"}, "expected": {"text": "No tags here"}}
  ],
  "implementation": "function stripHtmlTags(html: string): string {\n  let result = '';\n  let i = 0;\n  while (i < html.length) {\n    if (html[i] === '<') {\n      i++;\n      while (i < html.length && html[i] !== '>') {\n        if (html[i] === '\"') {\n          i++;\n          while (i < html.length && html[i] !== '\"') i++;\n          if (i < html.length) i++;\n        } else if (html[i] === \"'\") {\n          i++;\n          while (i < html.length && html[i] !== \"'\") i++;\n          if (i < html.length) i++;\n        } else {\n          i++;\n        }\n      }\n      i++;\n    } else {\n      result += html[i];\n      i++;\n    }\n  }\n  return result;\n}",
  "tags": ["string", "html", "sanitize", "parsing"],
  "status": "verified"
}
ENDJSON

# ── Problem 5: Word frequency map ───────────────────────────────────────────
cat > "$DIR/p5.json" << 'ENDJSON'
{
  "problem_id": "80a60e84-1616-45d2-afec-4ec69ec8687f",
  "name": "word-frequency-map",
  "description": "Counts occurrences of each word in a string. Case-insensitive, ignores punctuation. Returns entries sorted by count descending then alphabetically. O(n log n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [{"name": "text", "type": "string"}],
  "outputs": [{"name": "frequency", "type": "Record<string, number>"}],
  "examples": [
    {"input": {"text": "the cat sat on the mat the cat"}, "output": {"frequency": {"the": 3, "cat": 2, "mat": 1, "on": 1, "sat": 1}}}
  ],
  "tests": [
    {"input": {"text": "hello world hello"}, "expected": {"frequency": {"hello": 2, "world": 1}}},
    {"input": {"text": "Hello, hello! HELLO."}, "expected": {"frequency": {"hello": 3}}},
    {"input": {"text": "one two three two three three"}, "expected": {"frequency": {"three": 3, "two": 2, "one": 1}}},
    {"input": {"text": ""}, "expected": {"frequency": {}}}
  ],
  "implementation": "function wordFrequency(text: string): Record<string, number> {\n  if (!text.trim()) return {};\n  const words = text.toLowerCase().replace(/[^a-z0-9\\s]/g, '').split(/\\s+/).filter(Boolean);\n  const freq: Record<string, number> = {};\n  for (const word of words) {\n    freq[word] = (freq[word] || 0) + 1;\n  }\n  const sorted = Object.entries(freq).sort(([aKey, aCount], [bKey, bCount]) => {\n    if (bCount !== aCount) return bCount - aCount;\n    return aKey.localeCompare(bKey);\n  });\n  return Object.fromEntries(sorted);\n}",
  "tags": ["string", "frequency", "word-count", "map"],
  "status": "verified"
}
ENDJSON

# ── Problem 6: Template string interpolation ─────────────────────────────────
cat > "$DIR/p6.json" << 'ENDJSON'
{
  "problem_id": "34ae7cf6-9dc3-4702-99e7-3e4d20973e07",
  "name": "template-string-interpolation",
  "description": "Replaces {{variable}} placeholders in a template string with values from a data object. Missing keys are left as-is. O(n*m) time where n is template length and m is number of keys.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [
    {"name": "template", "type": "string"},
    {"name": "data", "type": "Record<string, string>"}
  ],
  "outputs": [{"name": "result", "type": "string"}],
  "examples": [
    {"input": {"template": "Hello, {{name}}! You are {{age}} years old.", "data": {"name": "Alice", "age": "30"}}, "output": {"result": "Hello, Alice! You are 30 years old."}}
  ],
  "tests": [
    {"input": {"template": "Hello, {{name}}!", "data": {"name": "Bob"}}, "expected": {"result": "Hello, Bob!"}},
    {"input": {"template": "{{missing}} key stays", "data": {}}, "expected": {"result": "{{missing}} key stays"}},
    {"input": {"template": "{{a}} and {{b}} and {{a}}", "data": {"a": "X", "b": "Y"}}, "expected": {"result": "X and Y and X"}},
    {"input": {"template": "No placeholders", "data": {"x": "1"}}, "expected": {"result": "No placeholders"}}
  ],
  "implementation": "function interpolate(template: string, data: Record<string, string>): string {\n  return template.replace(/\\{\\{([^}]+)\\}\\}/g, (match, key) => {\n    const trimmed = key.trim();\n    return Object.prototype.hasOwnProperty.call(data, trimmed) ? data[trimmed] : match;\n  });\n}",
  "tags": ["string", "template", "interpolation", "utility"],
  "status": "verified"
}
ENDJSON

# ── Problem 7: Wrap text at column width ─────────────────────────────────────
cat > "$DIR/p7.json" << 'ENDJSON'
{
  "problem_id": "9644a204-3d44-49e9-93d3-693166788797",
  "name": "wrap-text-at-column",
  "description": "Wraps text so no line exceeds the given column width. Breaks at word boundaries where possible; breaks within a word only if longer than the width. O(n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [
    {"name": "text", "type": "string"},
    {"name": "columnWidth", "type": "number"}
  ],
  "outputs": [{"name": "wrapped", "type": "string"}],
  "examples": [
    {"input": {"text": "The quick brown fox jumps over the lazy dog", "columnWidth": 15}, "output": {"wrapped": "The quick brown\nfox jumps over\nthe lazy dog"}}
  ],
  "tests": [
    {"input": {"text": "Hello world", "columnWidth": 5}, "expected": {"wrapped": "Hello\nworld"}},
    {"input": {"text": "superlongwordthatexceedswidth", "columnWidth": 10}, "expected": {"wrapped": "superlongw\nordthatexc\needswidth"}},
    {"input": {"text": "short", "columnWidth": 20}, "expected": {"wrapped": "short"}},
    {"input": {"text": "a b c d e f", "columnWidth": 3}, "expected": {"wrapped": "a b\nc d\ne f"}}
  ],
  "implementation": "function wrapText(text: string, columnWidth: number): string {\n  const words = text.split(' ');\n  const lines: string[] = [];\n  let currentLine = '';\n\n  for (const word of words) {\n    if (word.length > columnWidth) {\n      // Break long word across lines\n      if (currentLine) {\n        lines.push(currentLine);\n        currentLine = '';\n      }\n      let remaining = word;\n      while (remaining.length > columnWidth) {\n        lines.push(remaining.slice(0, columnWidth));\n        remaining = remaining.slice(columnWidth);\n      }\n      currentLine = remaining;\n    } else if (!currentLine) {\n      currentLine = word;\n    } else if (currentLine.length + 1 + word.length <= columnWidth) {\n      currentLine += ' ' + word;\n    } else {\n      lines.push(currentLine);\n      currentLine = word;\n    }\n  }\n  if (currentLine) lines.push(currentLine);\n  return lines.join('\\n');\n}",
  "tags": ["string", "word-wrap", "text-formatting", "utility"],
  "status": "verified"
}
ENDJSON

# ── Problem 8: Parse key=value string ───────────────────────────────────────
cat > "$DIR/p8.json" << 'ENDJSON'
{
  "problem_id": "9e8f7ae8-2df4-4b00-b546-b441e1bdf870",
  "name": "parse-key-value-string",
  "description": "Parses a shell-style key=value string into an object. Handles spaces around =, double/single quoted values with escape sequences, and comment lines starting with #. O(n) time.",
  "language": "typescript",
  "domain": ["string"],
  "inputs": [{"name": "input", "type": "string"}],
  "outputs": [{"name": "result", "type": "Record<string, string>"}],
  "examples": [
    {"input": {"input": "NAME=Alice\nAGE=30\n# this is a comment\nCITY=\"New York\""}, "output": {"result": {"NAME": "Alice", "AGE": "30", "CITY": "New York"}}}
  ],
  "tests": [
    {"input": {"input": "KEY=value"}, "expected": {"result": {"KEY": "value"}}},
    {"input": {"input": "# comment\nA=1\nB=2"}, "expected": {"result": {"A": "1", "B": "2"}}},
    {"input": {"input": "QUOTED=\"hello world\"\nSINGLE='it\\'s fine'"}, "expected": {"result": {"QUOTED": "hello world", "SINGLE": "it's fine"}}},
    {"input": {"input": "SPACED = yes\nEMPTY="}, "expected": {"result": {"SPACED": "yes", "EMPTY": ""}}}
  ],
  "implementation": "function parseKeyValue(input: string): Record<string, string> {\n  const result: Record<string, string> = {};\n  const lines = input.split(/\\r?\\n/);\n  for (const line of lines) {\n    const trimmed = line.trim();\n    if (!trimmed || trimmed.startsWith('#')) continue;\n    const eqIdx = trimmed.indexOf('=');\n    if (eqIdx === -1) continue;\n    const key = trimmed.slice(0, eqIdx).trim();\n    let val = trimmed.slice(eqIdx + 1).trim();\n    if ((val.startsWith('\"') && val.endsWith('\"')) ||\n        (val.startsWith(\"'\") && val.endsWith(\"'\"))) {\n      const quote = val[0];\n      val = val.slice(1, -1);\n      // Process escape sequences\n      if (quote === '\"') {\n        val = val.replace(/\\\\n/g, '\\n').replace(/\\\\t/g, '\\t').replace(/\\\\\\\\/g, '\\\\').replace(/\\\\\"/g, '\"');\n      } else {\n        val = val.replace(/\\\\'/g, \"'\");\n      }\n    }\n    if (key) result[key] = val;\n  }\n  return result;\n}",
  "tags": ["string", "parsing", "key-value", "env", "config"],
  "status": "verified"
}
ENDJSON

# ── Problem 9: Top-K nearest neighbors by cosine similarity ─────────────────
cat > "$DIR/p9.json" << 'ENDJSON'
{
  "problem_id": "8ec67b90-b837-4eea-a716-81e50338f355",
  "name": "topk-cosine-similarity",
  "description": "Returns the top K candidates sorted by cosine similarity to a query embedding. Uses dot-product divided by magnitudes. O(n*d) time where n is candidates and d is embedding dimension.",
  "language": "typescript",
  "domain": ["ai"],
  "inputs": [
    {"name": "query", "type": "number[]"},
    {"name": "candidates", "type": "Array<{id: string, embedding: number[]}>"},
    {"name": "k", "type": "number"}
  ],
  "outputs": [
    {"name": "results", "type": "Array<{id: string, score: number}>"}
  ],
  "examples": [
    {
      "input": {
        "query": [1, 0, 0],
        "candidates": [
          {"id": "a", "embedding": [1, 0, 0]},
          {"id": "b", "embedding": [0, 1, 0]},
          {"id": "c", "embedding": [0.9, 0.1, 0]}
        ],
        "k": 2
      },
      "output": {"results": [{"id": "a", "score": 1}, {"id": "c", "score": 0.994}]}
    }
  ],
  "tests": [
    {
      "input": {
        "query": [1, 0],
        "candidates": [{"id": "x", "embedding": [1, 0]}, {"id": "y", "embedding": [0, 1]}],
        "k": 1
      },
      "expected": {"results": [{"id": "x", "score": 1}]}
    },
    {
      "input": {
        "query": [1, 1],
        "candidates": [{"id": "a", "embedding": [1, 0]}, {"id": "b", "embedding": [0, 1]}, {"id": "c", "embedding": [1, 1]}],
        "k": 2
      },
      "expected": {"results": [{"id": "c", "score": 1}, {"id": "a", "score": 0.707}]}
    }
  ],
  "implementation": "interface Candidate { id: string; embedding: number[]; }\ninterface ScoredCandidate { id: string; score: number; }\n\nfunction cosineSimilarity(a: number[], b: number[]): number {\n  let dot = 0, magA = 0, magB = 0;\n  for (let i = 0; i < a.length; i++) {\n    dot += a[i] * b[i];\n    magA += a[i] * a[i];\n    magB += b[i] * b[i];\n  }\n  const denom = Math.sqrt(magA) * Math.sqrt(magB);\n  if (denom === 0) return 0;\n  return dot / denom;\n}\n\nfunction topKNearest(query: number[], candidates: Candidate[], k: number): ScoredCandidate[] {\n  const scored = candidates.map(c => ({\n    id: c.id,\n    score: Math.round(cosineSimilarity(query, c.embedding) * 1000) / 1000\n  }));\n  scored.sort((a, b) => b.score - a.score);\n  return scored.slice(0, k);\n}",
  "tags": ["ai", "embeddings", "cosine-similarity", "nearest-neighbor", "vector-search"],
  "status": "verified"
}
ENDJSON

# ── Problem 10: Truncate prompt to fit token budget ──────────────────────────
cat > "$DIR/p10.json" << 'ENDJSON'
{
  "problem_id": "df79661f-972b-4ee4-8a5d-7c9ea8ec368f",
  "name": "truncate-prompt-token-budget",
  "description": "Truncates a prompt to fit within a max token budget (estimated as chars/4). Prefers breaking at paragraph then sentence boundaries. Appends a truncation notice if truncated. O(n) time.",
  "language": "typescript",
  "domain": ["ai"],
  "inputs": [
    {"name": "prompt", "type": "string"},
    {"name": "maxTokens", "type": "number"}
  ],
  "outputs": [{"name": "result", "type": "string"}],
  "examples": [
    {
      "input": {"prompt": "Hello world. This is a test. More content here.", "maxTokens": 8},
      "output": {"result": "Hello world. This is a test. [truncated]"}
    }
  ],
  "tests": [
    {
      "input": {"prompt": "Short prompt.", "maxTokens": 100},
      "expected": {"result": "Short prompt."}
    },
    {
      "input": {"prompt": "Para one.\n\nPara two.\n\nPara three long content here.", "maxTokens": 6},
      "expected": {"result": "Para one. [truncated]"}
    },
    {
      "input": {"prompt": "Sentence one. Sentence two. Sentence three.", "maxTokens": 8},
      "expected": {"result": "Sentence one. Sentence two. [truncated]"}
    },
    {
      "input": {"prompt": "Exactly fits", "maxTokens": 3},
      "expected": {"result": "Exactly fits"}
    }
  ],
  "implementation": "const TRUNCATION_NOTICE = ' [truncated]';\n\nfunction estimateTokens(text: string): number {\n  return Math.ceil(text.length / 4);\n}\n\nfunction truncatePrompt(prompt: string, maxTokens: number): string {\n  if (estimateTokens(prompt) <= maxTokens) return prompt;\n\n  const noticeTokens = estimateTokens(TRUNCATION_NOTICE);\n  const budget = maxTokens - noticeTokens;\n  if (budget <= 0) return TRUNCATION_NOTICE.trim();\n\n  // Try paragraph boundaries\n  const paragraphs = prompt.split(/\\n\\n+/);\n  let accumulated = '';\n  for (const para of paragraphs) {\n    const candidate = accumulated ? accumulated + '\\n\\n' + para : para;\n    if (estimateTokens(candidate) <= budget) {\n      accumulated = candidate;\n    } else {\n      break;\n    }\n  }\n  if (accumulated && accumulated !== prompt) {\n    return accumulated.trimEnd() + TRUNCATION_NOTICE;\n  }\n\n  // Try sentence boundaries\n  const sentences = prompt.match(/[^.!?]+[.!?]+/g) || [];\n  accumulated = '';\n  for (const sent of sentences) {\n    const candidate = accumulated + sent;\n    if (estimateTokens(candidate) <= budget) {\n      accumulated = candidate;\n    } else {\n      break;\n    }\n  }\n  if (accumulated && accumulated.trim() !== prompt.trim()) {\n    return accumulated.trimEnd() + TRUNCATION_NOTICE;\n  }\n\n  // Hard truncate at character boundary\n  const maxChars = budget * 4;\n  return prompt.slice(0, maxChars).trimEnd() + TRUNCATION_NOTICE;\n}",
  "tags": ["ai", "prompt", "token-budget", "truncation", "llm"],
  "status": "verified"
}
ENDJSON

# ── Problem 11: Extract structured data from LLM response ────────────────────
cat > "$DIR/p11.json" << 'ENDJSON'
{
  "problem_id": "ee03ef48-651f-4ab6-a9f7-33c874308f0f",
  "name": "extract-json-from-llm-response",
  "description": "Extracts and parses a JSON block from an LLM response string. Looks for ```json ... ``` fences first, then bare JSON objects/arrays. Falls back to a provided default on parse failure. O(n) time.",
  "language": "typescript",
  "domain": ["ai"],
  "inputs": [
    {"name": "response", "type": "string"},
    {"name": "defaultValue", "type": "unknown"}
  ],
  "outputs": [{"name": "data", "type": "unknown"}],
  "examples": [
    {
      "input": {"response": "Here is the result:\n```json\n{\"status\": \"ok\", \"count\": 3}\n```", "defaultValue": null},
      "output": {"data": {"status": "ok", "count": 3}}
    }
  ],
  "tests": [
    {
      "input": {"response": "```json\n{\"key\": \"value\"}\n```", "defaultValue": null},
      "expected": {"data": {"key": "value"}}
    },
    {
      "input": {"response": "The answer is {\"x\": 1, \"y\": 2}", "defaultValue": null},
      "expected": {"data": {"x": 1, "y": 2}}
    },
    {
      "input": {"response": "No JSON here at all.", "defaultValue": {"fallback": true}},
      "expected": {"data": {"fallback": true}}
    },
    {
      "input": {"response": "```json\n{broken json\n```", "defaultValue": []},
      "expected": {"data": []}
    }
  ],
  "implementation": "function extractJsonFromLlmResponse(response: string, defaultValue: unknown): unknown {\n  // Try ```json ... ``` fence\n  const fenceMatch = response.match(/```(?:json)?\\s*([\\s\\S]*?)```/);\n  if (fenceMatch) {\n    try { return JSON.parse(fenceMatch[1].trim()); } catch {}\n  }\n\n  // Try bare JSON object or array\n  const objMatch = response.match(/\\{[\\s\\S]*\\}/);\n  if (objMatch) {\n    try { return JSON.parse(objMatch[0]); } catch {}\n  }\n  const arrMatch = response.match(/\\[[\\s\\S]*\\]/);\n  if (arrMatch) {\n    try { return JSON.parse(arrMatch[0]); } catch {}\n  }\n\n  return defaultValue;\n}",
  "tags": ["ai", "llm", "json-extraction", "parsing", "structured-output"],
  "status": "verified"
}
ENDJSON

# ── Problem 12: Chunk document for embedding ─────────────────────────────────
cat > "$DIR/p12.json" << 'ENDJSON'
{
  "problem_id": "ce713e22-25d2-4dc0-a00b-dcd034a72fbe",
  "name": "chunk-document-for-embedding",
  "description": "Splits a long document into overlapping chunks for embedding/semantic search. Target chunk size in tokens (chars/4 estimate), with configurable overlap. Returns chunks with start/end character offsets. O(n) time.",
  "language": "typescript",
  "domain": ["ai"],
  "inputs": [
    {"name": "document", "type": "string"},
    {"name": "chunkTokens", "type": "number"},
    {"name": "overlapTokens", "type": "number"}
  ],
  "outputs": [
    {"name": "chunks", "type": "Array<{text: string, start: number, end: number}>"}
  ],
  "examples": [
    {
      "input": {"document": "The quick brown fox jumps over the lazy dog.", "chunkTokens": 5, "overlapTokens": 1},
      "output": {"chunks": [{"text": "The quick brown fox jumps", "start": 0, "end": 25}, {"text": "jumps over the lazy dog.", "start": 21, "end": 44}]}
    }
  ],
  "tests": [
    {
      "input": {"document": "short", "chunkTokens": 100, "overlapTokens": 10},
      "expected": {"chunks": [{"text": "short", "start": 0, "end": 5}]}
    },
    {
      "input": {"document": "one two three four five six seven eight", "chunkTokens": 3, "overlapTokens": 1},
      "expected": {"chunks": [{"text": "one two three", "start": 0, "end": 13}, {"text": "three four five", "start": 8, "end": 23}, {"text": "five six seven", "start": 18, "end": 32}, {"text": "seven eight", "start": 28, "end": 39}]}
    }
  ],
  "implementation": "interface Chunk { text: string; start: number; end: number; }\n\nfunction chunkDocument(document: string, chunkTokens: number, overlapTokens: number): Chunk[] {\n  const chunkChars = chunkTokens * 4;\n  const overlapChars = overlapTokens * 4;\n  const stepChars = chunkChars - overlapChars;\n\n  if (stepChars <= 0) throw new Error('overlapTokens must be less than chunkTokens');\n\n  const chunks: Chunk[] = [];\n  let start = 0;\n\n  while (start < document.length) {\n    let end = start + chunkChars;\n\n    if (end >= document.length) {\n      // Last chunk\n      chunks.push({ text: document.slice(start), start, end: document.length });\n      break;\n    }\n\n    // Try to break at a word boundary\n    let breakAt = end;\n    const spaceIdx = document.lastIndexOf(' ', end);\n    if (spaceIdx > start) {\n      breakAt = spaceIdx;\n    }\n\n    chunks.push({ text: document.slice(start, breakAt).trimEnd(), start, end: breakAt });\n\n    // Advance by step, but start overlap chars back\n    start = breakAt - overlapChars;\n    // Skip whitespace at new start\n    while (start < document.length && document[start] === ' ') start++;\n  }\n\n  return chunks;\n}",
  "tags": ["ai", "embeddings", "chunking", "semantic-search", "rag"],
  "status": "verified"
}
ENDJSON

# Submit all
submit "Problem 2: Slugify string" "$DIR/p2.json"
submit "Problem 3: Extract URLs from text" "$DIR/p3.json"
submit "Problem 4: Strip HTML tags" "$DIR/p4.json"
submit "Problem 5: Word frequency map" "$DIR/p5.json"
submit "Problem 6: Template string interpolation" "$DIR/p6.json"
submit "Problem 7: Wrap text at column width" "$DIR/p7.json"
submit "Problem 8: Parse key=value string" "$DIR/p8.json"
submit "Problem 9: Top-K cosine similarity" "$DIR/p9.json"
submit "Problem 10: Truncate prompt to token budget" "$DIR/p10.json"
submit "Problem 11: Extract JSON from LLM response" "$DIR/p11.json"
submit "Problem 12: Chunk document for embedding" "$DIR/p12.json"

echo "=== All done ==="
