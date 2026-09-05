import assert from 'node:assert/strict';
import test from 'node:test';

import { helpText, parseCliArgs, runCli } from '../../../src/cli.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('CLI parses its help, run, and manual story surfaces', () => {
  assert.deepEqual(parseCliArgs([]), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['-h']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['run']), { kind: 'run' });
  assert.deepEqual(parseCliArgs(['run', '--artifacts-root', 'tmp/runs']), {
    kind: 'run', artifactsRoot: 'tmp/runs',
  });
  assert.deepEqual(parseCliArgs([
    'story', '--input-file', 'fixture.json', '--article-id', 'article-2',
    '--template', 'default-news-40s', '--artifacts-root', 'tmp/stories',
  ]), {
    kind: 'story',
    inputFile: 'fixture.json',
    articleId: 'article-2',
    templateId: 'default-news-40s',
    artifactsRoot: 'tmp/stories',
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
    () => parseCliArgs(['story', '--input-file', 'fixture.json']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === 'Story requires --article-id <articleId>.',
  );
  assert.throws(
    () => parseCliArgs(['story', '--article-id', 'article-1', '--input-file']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === '--input-file requires exactly one value.',
  );
  assert.throws(
    () => parseCliArgs(['run', '--artifacts-root']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === '--artifacts-root requires exactly one directory argument.',
  );
});

test('CLI delegates a manual story without live ngest configuration', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let received: Record<string, string | undefined> | undefined;

  const exitCode = await runCli([
    'story', '--input-file', 'fixture.json', '--article-id', 'article-2', '--artifacts-root', 'temp-stories',
  ], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  }, {
    createStory: async (dependencies) => {
      received = dependencies;
      return {
        storyRunId: 'story-123',
        artifactsRoot: 'temp-stories',
        storyDirectory: 'temp-stories/story-123',
        storyInputPath: 'temp-stories/story-123/story.json',
        storyRunPath: 'temp-stories/story-123/story-run.json',
        storyInput: { storyFingerprint: 'b'.repeat(64) } as never,
        template: { id: 'default-news-40s', version: '1' },
      };
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(received, {
    inputFile: 'fixture.json', articleId: 'article-2', artifactsRoot: 'temp-stories',
  });
  assert.match(stdout.join(''), /story-123/);
  assert.match(stdout.join(''), /b{64}/);
  assert.match(helpText, /vidgen story --input-file/);
  assert.deepEqual(stderr, []);
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
