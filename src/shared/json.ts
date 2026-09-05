import { VidGenError } from '../core/error.ts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];

const arrayIndexPattern = /^(0|[1-9]\d*)$/;
const maxArrayIndex = 2 ** 32 - 2;

/** Returns true only for values JSON.stringify can represent without coercion. */
export function isJsonValue(value: unknown): value is JsonValue {
  return inspectJsonValue(value, new WeakSet<object>());
}

/** Narrows an unknown value to the VidGen JSON boundary or fails explicitly. */
export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) {
    throw new VidGenError(
      'artifact',
      'Value is not JSON-safe.',
    );
  }
}

function inspectJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }

  if (ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? inspectJsonArray(value, ancestors)
      : inspectJsonObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function inspectJsonArray(value: unknown[], ancestors: WeakSet<object>): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') {
      continue;
    }

    if (typeof key !== 'string' || !arrayIndexPattern.test(key)) {
      return false;
    }

    const index = Number(key);
    if (index > maxArrayIndex || index >= value.length) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return false;
    }

    if (!inspectJsonValue(descriptor.value, ancestors)) {
      return false;
    }
  }

  return Object.keys(value).length === value.length;
}

function inspectJsonObject(
  value: object,
  ancestors: WeakSet<object>,
): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return false;
    }

    if (!inspectJsonValue(descriptor.value, ancestors)) {
      return false;
    }
  }

  return true;
}
