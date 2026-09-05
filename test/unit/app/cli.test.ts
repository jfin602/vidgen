import assert from 'node:assert/strict';
import test from 'node:test';

import { helpText, parseCliArgs, runCli } from '../../../src/cli.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('CLI parses its help and run surfaces', () => {
  assert.deepEqual(parseCliArgs([]), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['-h']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['run']), { kind: 'run' });
  assert.deepEqual(parseCliArgs(['run', '--artifacts-root', 'tmp/runs']), {
    kind: 'run', artifactsRoot: 'tmp/runs',
  });
});

test('CLI renders help without performing work', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli([], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [helpText]);
  assert.deepEqual(stderr, []);
});

test('CLI rejects unknown commands and invalid arguments deterministically', () => {
  assert.throws(
    () => parseCliArgs(['--help', 'extra']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === 'Help does not accept arguments: "extra".',
  );
  assert.throws(
    () => parseCliArgs(['run', '--artifacts-root']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === '--artifacts-root requires exactly one directory argument.',
  );
});

test('CLI delegates a run to the application service and prints observable identifiers', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let receivedRoot: string | undefined;

  const exitCode = await runCli(['run', '--artifacts-root', 'temp-artifacts'], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  }, {
    runInput: async ({ artifactsRoot }) => {
      receivedRoot = artifactsRoot;
      return {
        runId: 'run-123',
        inputFingerprint: 'a'.repeat(64),
        artifactsRoot: 'temp-artifacts',
        runDirectory: 'temp-artifacts/run-123',
        canonicalInputPath: 'temp-artifacts/run-123/01-canonical-input.json',
        canonicalInput: {} as never,
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedRoot, 'temp-artifacts');
  assert.match(stdout.join(''), /run-123/);
  assert.match(stdout.join(''), /a{64}/);
  assert.match(stdout.join(''), /temp-artifacts\\?\/run-123/);
  assert.deepEqual(stderr, []);
});
