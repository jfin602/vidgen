import assert from 'node:assert/strict';
import test from 'node:test';

import { assertJsonValue, isJsonValue } from '../../../src/shared/json.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('JSON helpers accept finite JSON primitives, arrays, and plain objects', () => {
  const value = {
    title: 'Edition',
    published: true,
    score: 1.5,
    nullable: null,
    stories: [{ id: 'article-1' }],
  };

  assert.equal(isJsonValue(value), true);
  assert.doesNotThrow(() => assertJsonValue(value));
});

test('JSON helpers reject values JSON would coerce or omit', () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;

  for (const value of [
    undefined,
    BigInt(1),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    () => undefined,
    new Date(),
    { omitted: undefined },
    [undefined],
    circular,
  ]) {
    assert.equal(isJsonValue(value), false);
  }

  assert.throws(
    () => assertJsonValue({ omitted: undefined }),
    (error: unknown) => error instanceof VidGenError
      && error.code === 'artifact'
      && error.publicMessage === 'Value is not JSON-safe.',
  );
});
