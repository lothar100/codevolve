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
  // 1. validate-json-schema
  {
    problem_id: "5d72b7bb-7c04-4503-99f3-cb401f7035f3",
    name: "validate-json-schema",
    description: "Validate a value against a JSON Schema subset supporting type, required, properties, items, minLength, maxLength, minimum, maximum, and enum.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["validation"],
    tags: ["json-schema", "validate", "schema"],
    inputs: [
      { name: "value", type: "unknown" },
      { name: "schema", type: "{ type?: string, required?: string[], properties?: Record<string,object>, items?: object, minLength?: number, maxLength?: number, minimum?: number, maximum?: number, enum?: unknown[] }" }
    ],
    outputs: [
      { name: "valid", type: "boolean" },
      { name: "errors", type: "string[]" }
    ],
    examples: [
      {
        input: { value: { name: "Alice", age: 30 }, schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, age: { type: "number" } } } },
        output: { valid: true, errors: [] }
      },
      {
        input: { value: { age: 30 }, schema: { type: "object", required: ["name"] } },
        output: { valid: false, errors: ["missing required field: name"] }
      }
    ],
    tests: [
      { input: { value: "hello", schema: { type: "string", minLength: 2, maxLength: 10 } }, expected: { valid: true, errors: [] } },
      { input: { value: "x", schema: { type: "string", minLength: 2 } }, expected: { valid: false, errors: ["minLength: expected >= 2, got 1"] } },
      { input: { value: 5, schema: { type: "number", minimum: 1, maximum: 10 } }, expected: { valid: true, errors: [] } },
      { input: { value: 15, schema: { type: "number", maximum: 10 } }, expected: { valid: false, errors: ["maximum: expected <= 10, got 15"] } },
      { input: { value: "red", schema: { enum: ["red", "green", "blue"] } }, expected: { valid: true, errors: [] } },
      { input: { value: "purple", schema: { enum: ["red", "green", "blue"] } }, expected: { valid: false, errors: ["enum: value not in allowed values"] } },
      { input: { value: [1, 2, 3], schema: { type: "array", items: { type: "number" } } }, expected: { valid: true, errors: [] } },
      { input: { value: [1, "x", 3], schema: { type: "array", items: { type: "number" } } }, expected: { valid: false, errors: ["items[1]: type: expected number, got string"] } }
    ],
    implementation: `
function validateJsonSchema(value, schema) {
  const errors = [];

  function validate(val, sch, path) {
    // enum check
    if (sch.enum !== undefined) {
      if (!sch.enum.some(e => JSON.stringify(e) === JSON.stringify(val))) {
        errors.push((path ? path + ': ' : '') + 'enum: value not in allowed values');
      }
    }

    // type check
    if (sch.type !== undefined) {
      const actualType = Array.isArray(val) ? 'array' : typeof val === 'object' && val !== null ? 'object' : val === null ? 'null' : typeof val;
      if (actualType !== sch.type) {
        errors.push((path ? path + ': ' : '') + 'type: expected ' + sch.type + ', got ' + actualType);
        return; // skip further checks if type is wrong
      }
    }

    // string checks
    if (typeof val === 'string') {
      if (sch.minLength !== undefined && val.length < sch.minLength) {
        errors.push((path ? path + ': ' : '') + 'minLength: expected >= ' + sch.minLength + ', got ' + val.length);
      }
      if (sch.maxLength !== undefined && val.length > sch.maxLength) {
        errors.push((path ? path + ': ' : '') + 'maxLength: expected <= ' + sch.maxLength + ', got ' + val.length);
      }
    }

    // number checks
    if (typeof val === 'number') {
      if (sch.minimum !== undefined && val < sch.minimum) {
        errors.push((path ? path + ': ' : '') + 'minimum: expected >= ' + sch.minimum + ', got ' + val);
      }
      if (sch.maximum !== undefined && val > sch.maximum) {
        errors.push((path ? path + ': ' : '') + 'maximum: expected <= ' + sch.maximum + ', got ' + val);
      }
    }

    // object checks
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      if (sch.required) {
        for (const req of sch.required) {
          if (!(req in val)) {
            errors.push((path ? path + ': ' : '') + 'missing required field: ' + req);
          }
        }
      }
      if (sch.properties) {
        for (const [key, propSchema] of Object.entries(sch.properties)) {
          if (key in val) {
            validate(val[key], propSchema, (path ? path + '.' : '') + key);
          }
        }
      }
    }

    // array checks
    if (Array.isArray(val)) {
      if (sch.items) {
        for (let i = 0; i < val.length; i++) {
          validate(val[i], sch.items, (path ? path : 'items') + '[' + i + ']');
        }
      }
    }
  }

  validate(value, schema, '');
  return { valid: errors.length === 0, errors };
}
`.trim(),
    confidence: 0.92
  },

  // 2. find-files-containing-pattern
  {
    problem_id: "5d7c3eeb-a993-43bb-b893-e3a16ca10ee1",
    name: "find-files-containing-pattern",
    description: "Search an array of file objects for lines matching a regex pattern. Returns match location and content for each hit.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["filesystem"],
    tags: ["grep", "search", "regex", "files"],
    inputs: [
      { name: "files", type: "Array<{ path: string, content: string }>" },
      { name: "pattern", type: "string" }
    ],
    outputs: [
      { name: "matches", type: "Array<{ file: string, lineNumber: number, lineContent: string }>" }
    ],
    examples: [
      {
        input: {
          files: [{ path: "a.ts", content: "const x = 1;\nconst y = 2;" }, { path: "b.ts", content: "let z = 3;" }],
          pattern: "const"
        },
        output: {
          matches: [
            { file: "a.ts", lineNumber: 1, lineContent: "const x = 1;" },
            { file: "a.ts", lineNumber: 2, lineContent: "const y = 2;" }
          ]
        }
      }
    ],
    tests: [
      {
        input: { files: [{ path: "f.ts", content: "hello\nworld\nhello again" }], pattern: "hello" },
        expected: { matches: [{ file: "f.ts", lineNumber: 1, lineContent: "hello" }, { file: "f.ts", lineNumber: 3, lineContent: "hello again" }] }
      },
      {
        input: { files: [{ path: "x.ts", content: "foo\nbar" }], pattern: "baz" },
        expected: { matches: [] }
      }
    ],
    implementation: `
function findFilesContainingPattern(files, pattern) {
  const regex = new RegExp(pattern);
  const matches = [];
  for (const file of files) {
    const lines = file.content.split('\\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: file.path, lineNumber: i + 1, lineContent: lines[i] });
      }
    }
  }
  return { matches };
}
`.trim(),
    confidence: 0.95
  },

  // 3. extract-ts-exports
  {
    problem_id: "fc024105-d968-44f0-a0a8-125c83288fc0",
    name: "extract-ts-exports",
    description: "Extract exported value and type identifiers from TypeScript source using regex patterns covering function, class, const, let, var, type, interface, and named exports.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["code"],
    tags: ["typescript", "exports", "ast", "module"],
    inputs: [
      { name: "source", type: "string" }
    ],
    outputs: [
      { name: "values", type: "string[]" },
      { name: "types", type: "string[]" }
    ],
    examples: [
      {
        input: { source: "export function foo() {}\nexport const bar = 1;\nexport type Baz = string;\nexport interface Qux {}" },
        output: { values: ["foo", "bar"], types: ["Baz", "Qux"] }
      }
    ],
    tests: [
      {
        input: { source: "export class MyClass {}\nexport let myVar = 2;\nexport interface MyInterface {}" },
        expected: { values: ["MyClass", "myVar"], types: ["MyInterface"] }
      },
      {
        input: { source: "export { alpha, beta };\nexport type { Gamma };" },
        expected: { values: ["alpha", "beta"], types: ["Gamma"] }
      },
      {
        input: { source: "const x = 1;\nfunction internal() {}" },
        expected: { values: [], types: [] }
      }
    ],
    implementation: `
function extractTsExports(source) {
  const values = [];
  const types = [];

  // export function/class/const/let/var name
  const valueDecl = /^export\\s+(?:async\\s+)?(?:function\\s+(?:\\*\\s*)?|class\\s+|const\\s+|let\\s+|var\\s+)([A-Za-z_$][\\w$]*)/gm;
  let m;
  while ((m = valueDecl.exec(source)) !== null) {
    values.push(m[1]);
  }

  // export type/interface name
  const typeDecl = /^export\\s+(?:type\\s+|interface\\s+)([A-Za-z_$][\\w$]*)/gm;
  while ((m = typeDecl.exec(source)) !== null) {
    types.push(m[1]);
  }

  // export { name1, name2 } — value re-exports
  const namedExport = /^export\\s+\\{([^}]+)\\}/gm;
  while ((m = namedExport.exec(source)) !== null) {
    const block = m[1];
    // skip if preceded by 'type' keyword (export type { ... })
    const lineStart = source.lastIndexOf('\\n', m.index) + 1;
    const prefix = source.slice(lineStart, m.index);
    if (/\\btype\\b/.test(prefix)) continue;
    const names = block.split(',').map(s => s.trim().split(/\\s+as\\s+/)[0].trim()).filter(Boolean);
    values.push(...names);
  }

  // export type { name1, name2 }
  const namedTypeExport = /^export\\s+type\\s+\\{([^}]+)\\}/gm;
  while ((m = namedTypeExport.exec(source)) !== null) {
    const names = m[1].split(',').map(s => s.trim().split(/\\s+as\\s+/)[0].trim()).filter(Boolean);
    types.push(...names);
  }

  return { values: [...new Set(values)], types: [...new Set(types)] };
}
`.trim(),
    confidence: 0.90
  },

  // 4. parse-multipart-form-data
  {
    problem_id: "e75e0c1f-9a7c-4a41-908d-26a4d6198715",
    name: "parse-multipart-form-data",
    description: "Parse a multipart/form-data body string given a boundary into an array of parts, each with parsed headers and body.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["http"],
    tags: ["multipart", "form-data", "parse"],
    inputs: [
      { name: "body", type: "string" },
      { name: "boundary", type: "string" }
    ],
    outputs: [
      { name: "parts", type: "Array<{ headers: Record<string, string>, body: string }>" }
    ],
    examples: [
      {
        input: {
          body: "--boundary\r\nContent-Disposition: form-data; name=\"field1\"\r\n\r\nvalue1\r\n--boundary--",
          boundary: "boundary"
        },
        output: {
          parts: [{ headers: { "content-disposition": "form-data; name=\"field1\"" }, body: "value1" }]
        }
      }
    ],
    tests: [
      {
        input: {
          body: "--abc\r\nContent-Type: text/plain\r\nContent-Disposition: form-data; name=\"f\"\r\n\r\nhello\r\n--abc--",
          boundary: "abc"
        },
        expected: {
          parts: [{
            headers: { "content-type": "text/plain", "content-disposition": "form-data; name=\"f\"" },
            body: "hello"
          }]
        }
      }
    ],
    implementation: `
function parseMultipartFormData(body, boundary) {
  const delimiter = '--' + boundary;
  const closeDelimiter = delimiter + '--';
  const parts = [];

  const segments = body.split(delimiter);
  for (const segment of segments) {
    // skip preamble and epilogue
    if (segment.trim() === '' || segment.startsWith('--')) continue;

    // strip leading CRLF
    const content = segment.replace(/^\\r?\\n/, '');

    // find header/body separator (blank line)
    const separatorIndex = content.search(/\\r?\\n\\r?\\n/);
    if (separatorIndex === -1) continue;

    const headerSection = content.slice(0, separatorIndex);
    // strip trailing CRLF from body
    let bodySection = content.slice(separatorIndex).replace(/^\\r?\\n/, '').replace(/\\r?\\n$/, '');

    const headers = {};
    for (const line of headerSection.split(/\\r?\\n/)) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }

    parts.push({ headers, body: bodySection });
  }

  return { parts };
}
`.trim(),
    confidence: 0.91
  },

  // 5. parse-csv
  {
    problem_id: "67921b38-2534-428e-a977-f6611011abf8",
    name: "parse-csv",
    description: "Parse a CSV string into an array of objects using the first row as headers. Handles quoted fields with embedded delimiters and configurable delimiters.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["filesystem"],
    tags: ["csv", "parse", "table", "data"],
    inputs: [
      { name: "csv", type: "string" },
      { name: "delimiter", type: "string" }
    ],
    outputs: [
      { name: "rows", type: "Record<string, string>[]" }
    ],
    examples: [
      {
        input: { csv: "name,age\nAlice,30\nBob,25", delimiter: "," },
        output: { rows: [{ name: "Alice", age: "30" }, { name: "Bob", age: "25" }] }
      }
    ],
    tests: [
      {
        input: { csv: "a,b\n1,2\n3,4", delimiter: "," },
        expected: { rows: [{ a: "1", b: "2" }, { a: "3", b: "4" }] }
      },
      {
        input: { csv: "x;y\nhello;world", delimiter: ";" },
        expected: { rows: [{ x: "hello", y: "world" }] }
      },
      {
        input: { csv: 'name,note\nAlice,"hello, world"\nBob,plain', delimiter: "," },
        expected: { rows: [{ name: "Alice", note: "hello, world" }, { name: "Bob", note: "plain" }] }
      }
    ],
    implementation: `
function parseCsv(csv, delimiter) {
  function parseLine(line, delim) {
    const fields = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        // quoted field
        let field = '';
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            field += line[i++];
          }
        }
        fields.push(field);
        // skip delimiter after closing quote
        if (line[i] === delim) i++;
      } else {
        // unquoted field
        const end = line.indexOf(delim, i);
        if (end === -1) {
          fields.push(line.slice(i));
          break;
        } else {
          fields.push(line.slice(i, end));
          i = end + delim.length;
        }
      }
    }
    return fields;
  }

  const lines = csv.split(/\\r?\\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { rows: [] };

  const headers = parseLine(lines[0], delimiter);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] !== undefined ? values[j] : '';
    }
    rows.push(row);
  }

  return { rows };
}
`.trim(),
    confidence: 0.93
  },

  // 6. count-lines-of-code
  {
    problem_id: "bf6ceda9-f0a8-42ad-800f-e6a82c05371a",
    name: "count-lines-of-code",
    description: "Count total, code, comment, and blank lines in source code. Supports // and /* */ for JS/TS, # for Python/Shell, and -- for SQL.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["code"],
    tags: ["loc", "cloc", "comments", "metrics"],
    inputs: [
      { name: "source", type: "string" },
      { name: "language", type: "string" }
    ],
    outputs: [
      { name: "total", type: "number" },
      { name: "code", type: "number" },
      { name: "comments", type: "number" },
      { name: "blank", type: "number" }
    ],
    examples: [
      {
        input: { source: "// comment\nconst x = 1;\n\n/* block */\nconst y = 2;", language: "javascript" },
        output: { total: 5, code: 2, comments: 2, blank: 1 }
      }
    ],
    tests: [
      {
        input: { source: "# comment\nx = 1\n\ny = 2", language: "python" },
        expected: { total: 4, code: 2, comments: 1, blank: 1 }
      },
      {
        input: { source: "-- sql comment\nSELECT 1;\n", language: "sql" },
        expected: { total: 2, code: 1, comments: 1, blank: 0 }
      },
      {
        input: { source: "function foo() {\n  // inline\n  return 1;\n}", language: "typescript" },
        expected: { total: 4, code: 3, comments: 1, blank: 0 }
      }
    ],
    implementation: `
function countLinesOfCode(source, language) {
  const lang = language.toLowerCase();
  const lines = source.split('\\n');

  const useSlash = ['javascript', 'js', 'typescript', 'ts', 'java', 'c', 'cpp', 'c++', 'go', 'rust', 'swift', 'kotlin'].includes(lang);
  const useHash = ['python', 'shell', 'bash', 'sh', 'ruby', 'perl', 'yaml', 'toml', 'r'].includes(lang);
  const useDash = ['sql'].includes(lang);

  let total = 0, code = 0, comments = 0, blank = 0;
  let inBlockComment = false;

  for (const line of lines) {
    total++;
    const trimmed = line.trim();

    if (trimmed === '') {
      blank++;
      continue;
    }

    if (useSlash) {
      if (inBlockComment) {
        comments++;
        if (trimmed.includes('*/')) inBlockComment = false;
        continue;
      }
      if (trimmed.startsWith('//')) {
        comments++;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        comments++;
        if (!trimmed.includes('*/') || trimmed.indexOf('*/') === trimmed.indexOf('/*') + 2) {
          // multi-line block comment starts
          if (!trimmed.includes('*/') || trimmed.endsWith('/*')) inBlockComment = true;
          // if it closes on same line, not a multi-line
          if (trimmed.includes('*/')) inBlockComment = false;
        }
        continue;
      }
      // inline block comment doesn't make it a comment line
      code++;
      continue;
    }

    if (useHash) {
      if (trimmed.startsWith('#')) {
        comments++;
        continue;
      }
      code++;
      continue;
    }

    if (useDash) {
      if (trimmed.startsWith('--')) {
        comments++;
        continue;
      }
      code++;
      continue;
    }

    // default: treat as code
    code++;
  }

  return { total, code, comments, blank };
}
`.trim(),
    confidence: 0.89
  },

  // 7. shell-command-config
  {
    problem_id: "1ab85220-5e80-437a-8e58-02e507cccbbd",
    name: "shell-command-config",
    description: "Build a spawn configuration object for running a shell command with timeout, capturing stdout and stderr separately.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["env"],
    tags: ["shell", "exec", "timeout", "process"],
    inputs: [
      { name: "command", type: "string" },
      { name: "args", type: "string[]" },
      { name: "timeoutMs", type: "number" }
    ],
    outputs: [
      { name: "spawnConfig", type: "object" }
    ],
    examples: [
      {
        input: { command: "node", args: ["script.js"], timeoutMs: 5000 },
        output: {
          spawnConfig: {
            command: "node",
            args: ["script.js"],
            options: { timeout: 5000, shell: true, stdio: "pipe" }
          }
        }
      }
    ],
    tests: [
      {
        input: { command: "ls", args: ["-la"], timeoutMs: 3000 },
        expected: { spawnConfig: { command: "ls", args: ["-la"], options: { timeout: 3000, shell: true, stdio: "pipe" } } }
      },
      {
        input: { command: "python", args: ["run.py", "--verbose"], timeoutMs: 10000 },
        expected: { spawnConfig: { command: "python", args: ["run.py", "--verbose"], options: { timeout: 10000, shell: true, stdio: "pipe" } } }
      }
    ],
    implementation: `
function shellCommandConfig(command, args, timeoutMs) {
  return {
    spawnConfig: {
      command,
      args,
      options: {
        timeout: timeoutMs,
        shell: true,
        stdio: "pipe"
      }
    }
  };
}
`.trim(),
    confidence: 0.97
  },

  // 8. generate-ts-interface
  {
    problem_id: "9ffd9a7b-bbb1-45b1-803f-2d5473cd4b6b",
    name: "generate-ts-interface",
    description: "Infer and generate a TypeScript interface definition from a JSON sample value, handling nested objects, arrays, primitives, and null.",
    version: "1.0.0",
    status: "verified",
    language: "javascript",
    domain: ["code"],
    tags: ["typescript", "codegen", "interface", "inference"],
    inputs: [
      { name: "value", type: "unknown" },
      { name: "interfaceName", type: "string" }
    ],
    outputs: [
      { name: "typescript", type: "string" }
    ],
    examples: [
      {
        input: { value: { name: "Alice", age: 30, active: true }, interfaceName: "User" },
        output: { typescript: "interface User {\n  name: string;\n  age: number;\n  active: boolean;\n}" }
      }
    ],
    tests: [
      {
        input: { value: { id: 1, tags: ["a", "b"] }, interfaceName: "Item" },
        expected: { typescript: "interface Item {\n  id: number;\n  tags: string[];\n}" }
      },
      {
        input: { value: { user: { name: "Bob", score: null } }, interfaceName: "Root" },
        expected: { typescript: "interface Root {\n  user: {\n    name: string;\n    score: null;\n  };\n}" }
      }
    ],
    implementation: `
function generateTsInterface(value, interfaceName) {
  function inferType(val, indent) {
    const pad = '  '.repeat(indent);
    if (val === null) return 'null';
    if (Array.isArray(val)) {
      if (val.length === 0) return 'unknown[]';
      const elementType = inferType(val[0], indent);
      return elementType + '[]';
    }
    if (typeof val === 'object') {
      const lines = ['{'];
      for (const [key, v] of Object.entries(val)) {
        const t = inferType(v, indent + 1);
        lines.push(pad + '  ' + key + ': ' + t + ';');
      }
      lines.push(pad + '}');
      return lines.join('\\n');
    }
    return typeof val;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const t = inferType(value, 0);
    return { typescript: 'type ' + interfaceName + ' = ' + t + ';' };
  }

  const lines = ['interface ' + interfaceName + ' {'];
  for (const [key, val] of Object.entries(value)) {
    const t = inferType(val, 1);
    lines.push('  ' + key + ': ' + t + ';');
  }
  lines.push('}');

  return { typescript: lines.join('\\n') };
}
`.trim(),
    confidence: 0.91
  }
];

console.log(`Submitting ${skills.length} skills...\n`);
for (const skill of skills) {
  await submit(skill);
}
console.log('\nDone.');
