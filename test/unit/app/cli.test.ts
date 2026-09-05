import assert from 'node:assert/strict';
import test from 'node:test';

import { helpText, parseCliArgs, runCli } from '../../../src/cli.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('CLI parses its help surface', () => {
  assert.deepEqual(parseCliArgs([]), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['-h']), { kind: 'help' });
});

test('CLI renders help without performing work', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = runCli([], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [helpText]);
  assert.deepEqual(stderr, []);
});

test('CLI rejects unknown commands and invalid help arguments deterministically', () => {
  assert.throws(
    () => parseCliArgs(['run']),
    (error: unknown) => error instanceof VidGenError
      && error.code === 'invalid_argument'
      && error.publicMessage === 'Unknown command: "run".',
  );
  assert.throws(
    () => parseCliArgs(['--help', 'extra']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === 'Help does not accept arguments: "extra".',
  );
});
