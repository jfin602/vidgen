import { VidGenError } from '../core/error.ts';
import { isJsonValue, type JsonObject, type JsonValue } from './json.ts';

/**
 * Serializes a JSON-safe value in a stable form suitable for identity inputs.
 * Object keys are sorted by Unicode code unit; array order remains meaningful.
 */
export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) {
    throw new VidGenError('artifact', 'Value is not JSON-safe.');
  }

  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(',')}]`;
  }

  return serializeObject(value);
}

function serializeObject(value: JsonObject): string {
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`)
    .join(',')}}`;
}
