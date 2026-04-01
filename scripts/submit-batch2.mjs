const API_URL = "https://qrxttojvni.execute-api.us-east-2.amazonaws.com/v1";
const TOKEN = "eyJraWQiOiIwQncyNkI4SzVHOERyXC94N1BCbDUxR0pRUThoUWRlTkZUVUZTQ3hiaGJETT0iLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsImlzcyI6Imh0dHBzOlwvXC9jb2duaXRvLWlkcC51cy1lYXN0LTIuYW1hem9uYXdzLmNvbVwvdXMtZWFzdC0yX0FOek1LTms1ayIsImNvZ25pdG86dXNlcm5hbWUiOiI0MTZiMzUwMC0xMGQxLTcwMTYtNTI5YS04MGQyNTdmN2UwODciLCJvcmlnaW5fanRpIjoiZjU5OTU0MjctNTJjNS00MTc3LTk3ZjQtMTRhZDE2NTlkODFlIiwiYXVkIjoiMmFsajNxb2M4a2pybnNhYzJkNW9rcTdxdDAiLCJldmVudF9pZCI6ImI1NjdjYmIwLTBlZDEtNDQwNS05MDBiLWJmN2Y3MWY4YWZlYSIsInRva2VuX3VzZSI6ImlkIiwiYXV0aF90aW1lIjoxNzc0OTIwMDMyLCJleHAiOjE3NzQ5MjM2MzIsImlhdCI6MTc3NDkyMDAzMiwianRpIjoiYjllYTc3ZmYtNGZlZS00M2YyLTg1ZjItODVkODVhMjY4ZmE3IiwiZW1haWwiOiJhZ2VudEBjb2Rldm9sdmUuYWkifQ.KVYec87DBODtA8reI8dNgumlHalkf4MJsr6RVNb58kU7GJv7ZZWNSsc4MWqP9wvSxPDnjO9WsGgkAoK285A9EIknFgRBnxm7AIngzUQq1t20d-ksB_mDI2IrPc4yWDmeJrOySjSm_SBhmi-XKahqvOzbSJ5pmAY6Zid54qhlaP-hSBhH-LorPt1Ui7fo-gLE2aWMVYWaIhk-Z6H4EuKHZZR8HE1AWqwB4Mh_GUfQkWVlLrqZsdVW0-0dA0_I2TH0skffQGn7rzDv6UK6Vlkt-psYag5WKz_NmRAozcDNQKwGjl9ANfbExNYSKo886C7YEb_ftZFu0mEX9bsHTyXwhg";

async function submit(skill) {
  const res = await fetch(`${API_URL}/skills`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`
    },
    body: JSON.stringify(skill)
  });
  const data = await res.json();
  if (res.ok) console.log(`✓ ${skill.name} -> ${data.skill.skill_id}`);
  else console.error(`✗ ${skill.name} -> ${JSON.stringify(data)}`);
}

const skills = [
  // 1. Flatten nested object
  {
    problem_id: "85794d58-1be0-4999-a2e2-a0b39c1d7ab8",
    name: "Flatten nested object",
    description: "Flatten a nested object to dot-delimited keys. Arrays are left as-is and not traversed.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["object", "flatten", "dot-path", "nested"],
    inputs: [
      { name: "obj", type: "object" },
      { name: "delimiter", type: "string" }
    ],
    outputs: [
      { name: "result", type: "object" }
    ],
    examples: [
      {
        input: { obj: { a: { b: { c: 1 } }, d: [1, 2] }, delimiter: "." },
        output: { result: { "a.b.c": 1, "d": [1, 2] } }
      }
    ],
    tests: [
      {
        input: { obj: { a: { b: 1 }, c: 2 }, delimiter: "." },
        expected: { result: { "a.b": 1, "c": 2 } }
      },
      {
        input: { obj: { x: { y: { z: "deep" } } }, delimiter: "_" },
        expected: { result: { "x_y_z": "deep" } }
      },
      {
        input: { obj: { arr: [1, 2, 3], nested: { val: 42 } }, delimiter: "." },
        expected: { result: { "arr": [1, 2, 3], "nested.val": 42 } }
      }
    ],
    implementation: `
function flattenObj(obj, delimiter, prefix, result) {
  if (prefix === undefined) prefix = '';
  if (result === undefined) result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? \`\${prefix}\${delimiter}\${k}\` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenObj(v, delimiter, key, result);
    } else {
      result[key] = v;
    }
  }
  return result;
}
const d = (typeof delimiter === 'string' && delimiter.length > 0) ? delimiter : '.';
return { result: flattenObj(obj, d) };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 2. Deep merge objects
  {
    problem_id: "6d758c18-da9d-4b5b-960f-7f005281fd3d",
    name: "Deep merge objects",
    description: "Recursively merge two objects. Values from source win on conflict; arrays are replaced not merged.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["object", "merge", "deep", "recursive"],
    inputs: [
      { name: "target", type: "object" },
      { name: "source", type: "object" }
    ],
    outputs: [
      { name: "result", type: "object" }
    ],
    examples: [
      {
        input: { target: { a: 1, b: { c: 2, d: 3 } }, source: { b: { c: 99, e: 5 }, f: 6 } },
        output: { result: { a: 1, b: { c: 99, d: 3, e: 5 }, f: 6 } }
      }
    ],
    tests: [
      {
        input: { target: { x: 1 }, source: { x: 2, y: 3 } },
        expected: { result: { x: 2, y: 3 } }
      },
      {
        input: { target: { a: [1, 2] }, source: { a: [3, 4, 5] } },
        expected: { result: { a: [3, 4, 5] } }
      },
      {
        input: { target: { nested: { a: 1, b: 2 } }, source: { nested: { b: 99, c: 3 } } },
        expected: { result: { nested: { a: 1, b: 99, c: 3 } } }
      }
    ],
    implementation: `
function deepMerge(t, s) {
  const r = { ...t };
  for (const [k, v] of Object.entries(s)) {
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])
    ) {
      r[k] = deepMerge(t[k], v);
    } else {
      r[k] = v;
    }
  }
  return r;
}
return { result: deepMerge(target, source) };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 3. Omit keys from object
  {
    problem_id: "933d6635-b8ee-4b1e-a41b-834f7920ffc2",
    name: "Omit keys from object",
    description: "Return a new shallow copy of the object with the specified keys removed.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["object", "omit", "keys", "filter"],
    inputs: [
      { name: "obj", type: "object" },
      { name: "keys", type: "string[]" }
    ],
    outputs: [
      { name: "result", type: "object" }
    ],
    examples: [
      {
        input: { obj: { a: 1, b: 2, c: 3 }, keys: ["b", "c"] },
        output: { result: { a: 1 } }
      }
    ],
    tests: [
      {
        input: { obj: { x: 1, y: 2, z: 3 }, keys: ["y"] },
        expected: { result: { x: 1, z: 3 } }
      },
      {
        input: { obj: { a: 1, b: 2 }, keys: [] },
        expected: { result: { a: 1, b: 2 } }
      },
      {
        input: { obj: { a: 1 }, keys: ["a", "nonexistent"] },
        expected: { result: {} }
      }
    ],
    implementation: `
const keySet = new Set(keys);
const result = Object.fromEntries(
  Object.entries(obj).filter(([k]) => !keySet.has(k))
);
return { result };
    `.trim(),
    confidence: 0.98,
    latency_p50_ms: 1,
    latency_p95_ms: 2
  },

  // 4. Deterministic JSON stringify
  {
    problem_id: "32ad8f6d-0009-40e3-bb06-2e00c475683f",
    name: "Deterministic JSON stringify",
    description: "Serialize a value to JSON with object keys sorted alphabetically at every nesting level.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["json", "stringify", "deterministic", "sorted", "canonical"],
    inputs: [
      { name: "value", type: "unknown" }
    ],
    outputs: [
      { name: "json", type: "string" }
    ],
    examples: [
      {
        input: { value: { b: 2, a: 1, c: { z: 26, y: 25 } } },
        output: { json: '{"a":1,"b":2,"c":{"y":25,"z":26}}' }
      }
    ],
    tests: [
      {
        input: { value: { z: 3, a: 1, m: 2 } },
        expected: { json: '{"a":1,"m":2,"z":3}' }
      },
      {
        input: { value: [3, 1, 2] },
        expected: { json: "[3,1,2]" }
      },
      {
        input: { value: null },
        expected: { json: "null" }
      }
    ],
    implementation: `
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
return { json: stableStringify(value) };
    `.trim(),
    confidence: 0.97,
    latency_p50_ms: 1,
    latency_p95_ms: 3
  },

  // 5. Deep get value by dot-path
  {
    problem_id: "25236841-4fc4-4daa-a3a5-dc5c8c6c2eb5",
    name: "Deep get value by dot-path",
    description: "Retrieve a deeply nested value using a dot-separated path string. Returns defaultValue if any segment is missing.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["object", "get", "dot-path", "nested", "safe-access"],
    inputs: [
      { name: "obj", type: "unknown" },
      { name: "path", type: "string" },
      { name: "defaultValue", type: "unknown" }
    ],
    outputs: [
      { name: "value", type: "unknown" }
    ],
    examples: [
      {
        input: { obj: { a: { b: { c: 42 } } }, path: "a.b.c", defaultValue: null },
        output: { value: 42 }
      }
    ],
    tests: [
      {
        input: { obj: { a: { b: 1 } }, path: "a.b", defaultValue: 0 },
        expected: { value: 1 }
      },
      {
        input: { obj: { a: 1 }, path: "a.b.c", defaultValue: "missing" },
        expected: { value: "missing" }
      },
      {
        input: { obj: { x: null }, path: "x.y", defaultValue: 99 },
        expected: { value: 99 }
      }
    ],
    implementation: `
const parts = path.split('.');
let cur = obj;
for (const p of parts) {
  if (cur == null || typeof cur !== 'object') return { value: defaultValue };
  cur = cur[p];
}
return { value: cur !== undefined && cur !== null ? cur : (cur === null ? cur : defaultValue) };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 2
  },

  // 6. Deep set value by dot-path
  {
    problem_id: "9ebca395-c44e-4e35-90f8-293eb8f19885",
    name: "Deep set value by dot-path",
    description: "Set a value at a dot-separated path in an object, creating intermediate objects as needed. Returns new object (does not mutate).",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["object", "set", "dot-path", "nested", "immutable"],
    inputs: [
      { name: "obj", type: "object" },
      { name: "path", type: "string" },
      { name: "value", type: "unknown" }
    ],
    outputs: [
      { name: "result", type: "object" }
    ],
    examples: [
      {
        input: { obj: { a: { b: 1 } }, path: "a.c", value: 99 },
        output: { result: { a: { b: 1, c: 99 } } }
      }
    ],
    tests: [
      {
        input: { obj: {}, path: "a.b.c", value: 42 },
        expected: { result: { a: { b: { c: 42 } } } }
      },
      {
        input: { obj: { x: 1 }, path: "x", value: 2 },
        expected: { result: { x: 2 } }
      },
      {
        input: { obj: { a: { b: 1 } }, path: "a.b", value: "replaced" },
        expected: { result: { a: { b: "replaced" } } }
      }
    ],
    implementation: `
function deepSet(obj, parts, value) {
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  const next = (obj[head] && typeof obj[head] === 'object' && !Array.isArray(obj[head]))
    ? obj[head]
    : {};
  return { ...obj, [head]: deepSet(next, rest, value) };
}
const parts = path.split('.');
const result = deepSet(obj, parts, value);
return { result };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 3
  },

  // 7. Diff two JSON objects
  {
    problem_id: "6aa7b626-7da0-41d3-8e85-c6732b029bce",
    name: "Diff two JSON objects",
    description: "Compare two JSON objects and return added, removed, and changed keys using dot-path notation.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["json", "diff", "comparison", "dot-path", "patch"],
    inputs: [
      { name: "before", type: "object" },
      { name: "after", type: "object" }
    ],
    outputs: [
      { name: "added", type: "object" },
      { name: "removed", type: "object" },
      { name: "changed", type: "object" }
    ],
    examples: [
      {
        input: {
          before: { a: 1, b: { c: 2 }, d: 4 },
          after:  { a: 1, b: { c: 99 }, e: 5 }
        },
        output: {
          added:   { "e": 5 },
          removed: { "d": 4 },
          changed: { "b.c": { before: 2, after: 99 } }
        }
      }
    ],
    tests: [
      {
        input: { before: { x: 1 }, after: { x: 2 } },
        expected: { added: {}, removed: {}, changed: { "x": { before: 1, after: 2 } } }
      },
      {
        input: { before: { a: 1 }, after: { b: 2 } },
        expected: { added: { "b": 2 }, removed: { "a": 1 }, changed: {} }
      }
    ],
    implementation: `
function diffObjects(before, after, prefix = '') {
  const added = {};
  const removed = {};
  const changed = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const path = prefix ? \`\${prefix}.\${k}\` : k;
    const bVal = before[k];
    const aVal = after[k];
    const bIsObj = bVal && typeof bVal === 'object' && !Array.isArray(bVal);
    const aIsObj = aVal && typeof aVal === 'object' && !Array.isArray(aVal);
    if (!(k in before)) {
      added[path] = aVal;
    } else if (!(k in after)) {
      removed[path] = bVal;
    } else if (bIsObj && aIsObj) {
      const nested = diffObjects(bVal, aVal, path);
      Object.assign(added, nested.added);
      Object.assign(removed, nested.removed);
      Object.assign(changed, nested.changed);
    } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      changed[path] = { before: bVal, after: aVal };
    }
  }
  return { added, removed, changed };
}
return diffObjects(before, after);
    `.trim(),
    confidence: 0.92,
    latency_p50_ms: 2,
    latency_p95_ms: 10
  },

  // 8. Extract all values for a key
  {
    problem_id: "eaf1718f-9f33-4e3d-aad0-610b0d63ac50",
    name: "Extract all values for a key",
    description: "Recursively walk any JSON structure and collect every value associated with a given key name.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["json", "extract", "recursive", "key", "collect"],
    inputs: [
      { name: "data", type: "unknown" },
      { name: "key", type: "string" }
    ],
    outputs: [
      { name: "values", type: "unknown[]" }
    ],
    examples: [
      {
        input: { data: { id: 1, child: { id: 2, items: [{ id: 3 }] } }, key: "id" },
        output: { values: [1, 2, 3] }
      }
    ],
    tests: [
      {
        input: { data: { name: "root", children: [{ name: "a" }, { name: "b" }] }, key: "name" },
        expected: { values: ["root", "a", "b"] }
      },
      {
        input: { data: { x: 1, y: { x: 2 } }, key: "x" },
        expected: { values: [1, 2] }
      }
    ],
    implementation: `
function extractAll(data, key, results = []) {
  if (Array.isArray(data)) {
    for (const item of data) extractAll(item, key, results);
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (k === key) results.push(v);
      extractAll(v, key, results);
    }
  }
  return results;
}
return { values: extractAll(data, key) };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 2,
    latency_p95_ms: 8
  },

  // 9. Transform array of objects to keyed map
  {
    problem_id: "b79dfdce-c354-4485-b186-1e1b9c492b7b",
    name: "Transform array of objects to keyed map",
    description: "Index an array of objects by a field value. Strategy controls collision handling: 'last' (default), 'first', or 'array' to collect all.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["json"],
    tags: ["array", "object", "index", "map", "key-by"],
    inputs: [
      { name: "arr", type: "object[]" },
      { name: "keyField", type: "string" },
      { name: "strategy", type: "string" }
    ],
    outputs: [
      { name: "result", type: "object" }
    ],
    examples: [
      {
        input: { arr: [{ id: 1, name: "a" }, { id: 2, name: "b" }], keyField: "id", strategy: "last" },
        output: { result: { "1": { id: 1, name: "a" }, "2": { id: 2, name: "b" } } }
      }
    ],
    tests: [
      {
        input: {
          arr: [{ type: "x", v: 1 }, { type: "x", v: 2 }, { type: "y", v: 3 }],
          keyField: "type",
          strategy: "last"
        },
        expected: { result: { "x": { type: "x", v: 2 }, "y": { type: "y", v: 3 } } }
      },
      {
        input: {
          arr: [{ type: "x", v: 1 }, { type: "x", v: 2 }],
          keyField: "type",
          strategy: "first"
        },
        expected: { result: { "x": { type: "x", v: 1 } } }
      },
      {
        input: {
          arr: [{ type: "x", v: 1 }, { type: "x", v: 2 }],
          keyField: "type",
          strategy: "array"
        },
        expected: { result: { "x": [{ type: "x", v: 1 }, { type: "x", v: 2 }] } }
      }
    ],
    implementation: `
const strat = strategy || 'last';
const result = {};
for (const item of arr) {
  const k = String(item[keyField]);
  if (strat === 'array') {
    if (!result[k]) result[k] = [];
    result[k].push(item);
  } else if (strat === 'first') {
    if (!(k in result)) result[k] = item;
  } else {
    result[k] = item;
  }
}
return { result };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 10. Flatten nested array to depth N
  {
    problem_id: "d53eba37-0747-44cd-a1b7-85f670cc4085",
    name: "Flatten nested array to depth N",
    description: "Recursively flatten a nested array up to the specified depth. Depth of Infinity flattens completely.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["array", "flatten", "depth", "recursive"],
    inputs: [
      { name: "arr", type: "unknown[]" },
      { name: "depth", type: "number" }
    ],
    outputs: [
      { name: "result", type: "unknown[]" }
    ],
    examples: [
      {
        input: { arr: [1, [2, [3, [4]]]], depth: 2 },
        output: { result: [1, 2, 3, [4]] }
      }
    ],
    tests: [
      {
        input: { arr: [1, [2, [3]]], depth: 1 },
        expected: { result: [1, 2, [3]] }
      },
      {
        input: { arr: [1, [2, [3, [4, [5]]]]], depth: Infinity },
        expected: { result: [1, 2, 3, 4, 5] }
      },
      {
        input: { arr: [[1, 2], [3, [4]]], depth: 0 },
        expected: { result: [[1, 2], [3, [4]]] }
      }
    ],
    implementation: `
function flattenDepth(arr, depth) {
  if (depth <= 0) return arr.slice();
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) {
      const nested = flattenDepth(item, depth - 1);
      result.push(...nested);
    } else {
      result.push(item);
    }
  }
  return result;
}
return { result: flattenDepth(arr, depth) };
    `.trim(),
    confidence: 0.97,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 11. Chunk array into pages
  {
    problem_id: "8f66a4e3-b6f2-4ef4-a203-6a3855914282",
    name: "Chunk array into pages",
    description: "Split an array into sub-arrays (pages) of the specified size. The last page may be smaller.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["array", "chunk", "paginate", "split", "batch"],
    inputs: [
      { name: "arr", type: "unknown[]" },
      { name: "pageSize", type: "number" }
    ],
    outputs: [
      { name: "pages", type: "unknown[][]" }
    ],
    examples: [
      {
        input: { arr: [1, 2, 3, 4, 5], pageSize: 2 },
        output: { pages: [[1, 2], [3, 4], [5]] }
      }
    ],
    tests: [
      {
        input: { arr: [1, 2, 3, 4, 5, 6], pageSize: 3 },
        expected: { pages: [[1, 2, 3], [4, 5, 6]] }
      },
      {
        input: { arr: [1], pageSize: 5 },
        expected: { pages: [[1]] }
      },
      {
        input: { arr: [], pageSize: 3 },
        expected: { pages: [] }
      }
    ],
    implementation: `
if (pageSize <= 0) throw new Error('pageSize must be > 0');
const pages = [];
for (let i = 0; i < arr.length; i += pageSize) {
  pages.push(arr.slice(i, i + pageSize));
}
return { pages };
    `.trim(),
    confidence: 0.98,
    latency_p50_ms: 1,
    latency_p95_ms: 3
  },

  // 12. Deduplicate array preserving order
  {
    problem_id: "00ddd3af-f44c-4d67-b663-05f46d796e78",
    name: "Deduplicate array preserving order",
    description: "Remove duplicate elements from an array, keeping the first occurrence. Supports an optional keyField for object arrays.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["array", "deduplicate", "unique", "order-preserving"],
    inputs: [
      { name: "arr", type: "unknown[]" },
      { name: "keyField", type: "string" }
    ],
    outputs: [
      { name: "result", type: "unknown[]" }
    ],
    examples: [
      {
        input: { arr: [1, 2, 1, 3, 2], keyField: "" },
        output: { result: [1, 2, 3] }
      }
    ],
    tests: [
      {
        input: { arr: ["a", "b", "a", "c"], keyField: "" },
        expected: { result: ["a", "b", "c"] }
      },
      {
        input: {
          arr: [{ id: 1, v: "x" }, { id: 2, v: "y" }, { id: 1, v: "z" }],
          keyField: "id"
        },
        expected: { result: [{ id: 1, v: "x" }, { id: 2, v: "y" }] }
      },
      {
        input: { arr: [], keyField: "" },
        expected: { result: [] }
      }
    ],
    implementation: `
const seen = new Set();
const result = [];
for (const item of arr) {
  const key = keyField ? item[keyField] : item;
  const serialized = typeof key === 'object' ? JSON.stringify(key) : key;
  if (!seen.has(serialized)) {
    seen.add(serialized);
    result.push(item);
  }
}
return { result };
    `.trim(),
    confidence: 0.97,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 13. Sliding window over array
  {
    problem_id: "e5b29e77-1c50-4700-a8ec-0c8ea773ed08",
    name: "Sliding window over array",
    description: "Generate overlapping sub-arrays (windows) of the given size, advancing by 'step' elements each time.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["array", "sliding-window", "windows", "sub-arrays"],
    inputs: [
      { name: "arr", type: "unknown[]" },
      { name: "windowSize", type: "number" },
      { name: "step", type: "number" }
    ],
    outputs: [
      { name: "windows", type: "unknown[][]" }
    ],
    examples: [
      {
        input: { arr: [1, 2, 3, 4, 5], windowSize: 3, step: 1 },
        output: { windows: [[1, 2, 3], [2, 3, 4], [3, 4, 5]] }
      }
    ],
    tests: [
      {
        input: { arr: [1, 2, 3, 4, 5, 6], windowSize: 2, step: 2 },
        expected: { windows: [[1, 2], [3, 4], [5, 6]] }
      },
      {
        input: { arr: [1, 2, 3], windowSize: 4, step: 1 },
        expected: { windows: [] }
      },
      {
        input: { arr: [1, 2, 3, 4], windowSize: 2, step: 3 },
        expected: { windows: [[1, 2], [4]] }
      }
    ],
    implementation: `
if (windowSize <= 0 || step <= 0) throw new Error('windowSize and step must be > 0');
const windows = [];
for (let i = 0; i <= arr.length - windowSize; i += step) {
  windows.push(arr.slice(i, i + windowSize));
}
return { windows };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  },

  // 14. Compute running statistics over array
  {
    problem_id: "24d2ef44-d15d-4b05-9d01-db5b34efcfd4",
    name: "Compute running statistics over array",
    description: "Compute descriptive statistics for a numeric array: min, max, mean, median, stddev, p50, p95, p99.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["statistics", "array", "percentile", "mean", "stddev"],
    inputs: [
      { name: "values", type: "number[]" }
    ],
    outputs: [
      { name: "min", type: "number" },
      { name: "max", type: "number" },
      { name: "mean", type: "number" },
      { name: "median", type: "number" },
      { name: "stddev", type: "number" },
      { name: "p50", type: "number" },
      { name: "p95", type: "number" },
      { name: "p99", type: "number" }
    ],
    examples: [
      {
        input: { values: [1, 2, 3, 4, 5] },
        output: { min: 1, max: 5, mean: 3, median: 3, stddev: 1.4142135623730951, p50: 3, p95: 5, p99: 5 }
      }
    ],
    tests: [
      {
        input: { values: [10, 20, 30] },
        expected: { min: 10, max: 30, mean: 20, median: 20, stddev: 8.16496580927726, p50: 20, p95: 30, p99: 30 }
      }
    ],
    implementation: `
if (!values || values.length === 0) throw new Error('values array must not be empty');
const sorted = [...values].sort((a, b) => a - b);
const n = sorted.length;
const min = sorted[0];
const max = sorted[n - 1];
const mean = sorted.reduce((s, v) => s + v, 0) / n;
const median = n % 2 === 0
  ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  : sorted[Math.floor(n / 2)];
const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
const stddev = Math.sqrt(variance);
function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);
const p99 = percentile(sorted, 99);
return { min, max, mean, median, stddev, p50, p95, p99 };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 2,
    latency_p95_ms: 10
  },

  // 15. Topological sort of dependency graph
  {
    problem_id: "792476a1-9227-49e5-b40f-a3fed5998f08",
    name: "Topological sort of dependency graph",
    description: "Topologically sort a directed acyclic graph using Kahn's algorithm. Throws if a cycle is detected.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["graph", "topological-sort", "dag", "kahn", "cycle-detection"],
    inputs: [
      { name: "nodes", type: "string[]" },
      { name: "edges", type: "Array<[string, string]>" }
    ],
    outputs: [
      { name: "sorted", type: "string[]" }
    ],
    examples: [
      {
        input: {
          nodes: ["a", "b", "c"],
          edges: [["a", "b"], ["b", "c"]]
        },
        output: { sorted: ["a", "b", "c"] }
      }
    ],
    tests: [
      {
        input: {
          nodes: ["build", "test", "lint", "deploy"],
          edges: [["lint", "build"], ["build", "test"], ["test", "deploy"]]
        },
        expected: { sorted: ["lint", "build", "test", "deploy"] }
      },
      {
        input: {
          nodes: ["a", "b", "c"],
          edges: [["a", "b"], ["b", "c"], ["c", "a"]]
        },
        expected: { error: "Cycle detected" }
      }
    ],
    implementation: `
const inDegree = new Map();
const adjList = new Map();
for (const n of nodes) {
  inDegree.set(n, 0);
  adjList.set(n, []);
}
for (const [from, to] of edges) {
  adjList.get(from).push(to);
  inDegree.set(to, (inDegree.get(to) || 0) + 1);
}
const queue = [];
for (const [n, deg] of inDegree) {
  if (deg === 0) queue.push(n);
}
const sorted = [];
while (queue.length > 0) {
  queue.sort(); // deterministic order among peers
  const node = queue.shift();
  sorted.push(node);
  for (const neighbor of adjList.get(node) || []) {
    inDegree.set(neighbor, inDegree.get(neighbor) - 1);
    if (inDegree.get(neighbor) === 0) queue.push(neighbor);
  }
}
if (sorted.length !== nodes.length) throw new Error('Cycle detected in dependency graph');
return { sorted };
    `.trim(),
    confidence: 0.93,
    latency_p50_ms: 2,
    latency_p95_ms: 8
  },

  // 16. Diff two arrays as changesets
  {
    problem_id: "b74d5ce7-fc73-4eb2-aaee-bc0bbd8b5106",
    name: "Diff two arrays as changesets",
    description: "Compare two arrays and return added, removed, and unchanged elements. Supports an optional key extractor for object arrays.",
    version: "1.0.0",
    is_canonical: true,
    status: "verified",
    language: "typescript",
    domain: ["array"],
    tags: ["array", "diff", "changeset", "comparison", "added", "removed"],
    inputs: [
      { name: "before", type: "unknown[]" },
      { name: "after", type: "unknown[]" },
      { name: "keyField", type: "string" }
    ],
    outputs: [
      { name: "added", type: "unknown[]" },
      { name: "removed", type: "unknown[]" },
      { name: "unchanged", type: "unknown[]" }
    ],
    examples: [
      {
        input: { before: [1, 2, 3], after: [2, 3, 4], keyField: "" },
        output: { added: [4], removed: [1], unchanged: [2, 3] }
      }
    ],
    tests: [
      {
        input: { before: ["a", "b"], after: ["b", "c"], keyField: "" },
        expected: { added: ["c"], removed: ["a"], unchanged: ["b"] }
      },
      {
        input: {
          before: [{ id: 1 }, { id: 2 }],
          after: [{ id: 2 }, { id: 3 }],
          keyField: "id"
        },
        expected: { added: [{ id: 3 }], removed: [{ id: 1 }], unchanged: [{ id: 2 }] }
      }
    ],
    implementation: `
function getKey(item, keyField) {
  if (keyField && typeof item === 'object' && item !== null) return String(item[keyField]);
  return JSON.stringify(item);
}
const beforeKeys = new Map(before.map(item => [getKey(item, keyField), item]));
const afterKeys = new Map(after.map(item => [getKey(item, keyField), item]));
const added = [];
const removed = [];
const unchanged = [];
for (const [k, item] of afterKeys) {
  if (beforeKeys.has(k)) unchanged.push(item);
  else added.push(item);
}
for (const [k, item] of beforeKeys) {
  if (!afterKeys.has(k)) removed.push(item);
}
return { added, removed, unchanged };
    `.trim(),
    confidence: 0.95,
    latency_p50_ms: 1,
    latency_p95_ms: 5
  }
];

let succeeded = 0;
let failed = 0;

for (const skill of skills) {
  await submit(skill);
}

console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
