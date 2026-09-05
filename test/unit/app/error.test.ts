import assert from 'node:assert/strict';
import test from 'node:test';

import { isVidGenError, VidGenError } from '../../../src/core/error.ts';

test('VidGenError exposes a stable code and safe public message', () => {
  const cause = new Error('token=secret-value');
  const error = new VidGenError('transport', 'Unable to reach the source service.', {
    cause,
  });

  assert.equal(error.name, 'VidGenError');
  assert.equal(error.code, 'transport');
  assert.equal(error.message, 'Unable to reach the source service.');
  assert.equal(error.publicMessage, 'Unable to reach the source service.');
  assert.equal(error.cause, cause);
  assert.equal(isVidGenError(error), true);
  assert.equal(isVidGenError(cause), false);
});
