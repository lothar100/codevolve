export function encode(input: unknown): string {
  return JSON.stringify(input);
}

export function decode(input: string): unknown {
  return JSON.parse(input);
}
