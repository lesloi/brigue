/**
 * Canonical JSON: sorted keys, no whitespace, integers unquoted.
 *
 * Two runs of the same world must produce byte-identical output, otherwise the
 * state hash is worthless as a replay test and a difference in key insertion
 * order would look like a bug in the simulation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonical JSON cannot hold ${value}`);
      }
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonical JSON cannot hold a ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);

  return `{${entries.join(',')}}`;
}
