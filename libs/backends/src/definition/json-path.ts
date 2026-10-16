export function readJsonPath(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => (isRecord(value) ? value[segment] : undefined), body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
