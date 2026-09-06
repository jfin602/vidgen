import assert from 'node:assert/strict';
import test from 'node:test';
import './headline-workflow.test.ts';

import { helpText, parseCliArgs, runCli } from '../../../src/cli.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('CLI parses its help, run, manual story, planning, media, and assembly surfaces', () => {
  assert.deepEqual(parseCliArgs([]), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['--help']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['-h']), { kind: 'help' });
  assert.deepEqual(parseCliArgs(['run']), { kind: 'run' });
  assert.deepEqual(parseCliArgs(['headline', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf']), { kind: 'headline', inputFile: 'fixture.json', articleId: 'article-2', maxSeconds: 20, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf' });
  assert.deepEqual(parseCliArgs(['headline', '--input-file', 'fixture.json', '--article-id', 'article-2', '--max-seconds', '4', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf', '--artifacts-root', 'clips']), { kind: 'headline', inputFile: 'fixture.json', articleId: 'article-2', maxSeconds: 4, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf', artifactsRoot: 'clips' });
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
  assert.deepEqual(parseCliArgs(['assemble', '--story-dir', 'tmp/stories/ready', '--intro', 'intro.mp4', '--outro', 'outro.mp4', '--font-file', 'font.ttf']), {
    kind: 'assemble', storyDirectory: 'tmp/stories/ready', introPath: 'intro.mp4', outroPath: 'outro.mp4', fontPath: 'font.ttf',
  });
  assert.deepEqual(parseCliArgs(['assemble', '--story-dir', 'tmp/stories/ready', '--intro', 'intro.mp4']), {
    kind: 'assemble', storyDirectory: 'tmp/stories/ready', introPath: 'intro.mp4',
  });
  assert.deepEqual(parseCliArgs(['assemble', '--story-dir', 'tmp/stories/ready', '--outro', 'outro.mp4']), {
    kind: 'assemble', storyDirectory: 'tmp/stories/ready', outroPath: 'outro.mp4',
  });
  assert.deepEqual(parseCliArgs(['assemble', '--story-dir', 'tmp/stories/ready']), {
    kind: 'assemble', storyDirectory: 'tmp/stories/ready',
  });
  assert.deepEqual(parseCliArgs([
    'plan', '--input-file', 'fixture.json', '--article-id', 'article-2',
    '--template', 'default-news-40s', '--artifacts-root', 'tmp/stories',
  ]), {
    kind: 'plan',
    inputFile: 'fixture.json',
    articleId: 'article-2',
    templateId: 'default-news-40s',
    artifactsRoot: 'tmp/stories',
  });
  assert.deepEqual(parseCliArgs([
    'media', '--story-dir', 'tmp/stories/planned', '--anchor-reference', 'anchor-a.png', '--anchor-reference', 'anchor-b.png',
  ]), {
    kind: 'media', storyDirectory: 'tmp/stories/planned', anchorReferencePaths: ['anchor-a.png', 'anchor-b.png'],
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
    () => parseCliArgs(['plan', '--article-id', 'article-1']),
    (error: unknown) => error instanceof VidGenError
      && error.publicMessage === 'Plan requires --input-file <manifest.json>.',
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
  assert.throws(() => parseCliArgs(['media']), /Media requires --story-dir/);
  assert.throws(() => parseCliArgs(['headline', '--input-file', 'fixture.json', '--article-id', 'article-1', '--anchor-reference', 'a', '--font-file', 'font.ttf', '--max-seconds', '3']), /whole number from 4 through 20/);
  assert.throws(() => parseCliArgs(['assemble', '--intro', 'intro.mp4']), /Assemble requires --story-dir/);
  assert.throws(() => parseCliArgs(['media', '--story-dir', 'story', '--anchor-reference', 'a', '--anchor-reference', 'b', '--anchor-reference', 'c', '--anchor-reference', 'd']), /at most three/);
});

test('CLI delegates assembly and reports only final safe facts', async () => {
  const stdout: string[] = [];
  const code = await runCli(['assemble', '--story-dir', 'workspace', '--intro', 'intro.mp4', '--outro', 'outro.mp4'], { writeStdout: (text) => stdout.push(text), writeStderr: () => undefined }, {
    assembleStory: async (input) => {
      assert.deepEqual(input, { storyDirectory: 'workspace', introPath: 'intro.mp4', outroPath: 'outro.mp4' });
      return { status: 'final_ready', storyRunId: 'story-123', assemblyRunId: 'assembly-123', finalPath: 'final/clip.mp4', finalSha256: 'a'.repeat(64), durationSeconds: 45 };
    },
  });
  assert.equal(code, 0);
  assert.match(stdout.join(''), /final_ready/);
  assert.match(stdout.join(''), /final\/clip\.mp4/);
  assert.match(helpText, /consumes an existing media-ready story/i);
});

test('CLI delegates each optional wrapper form without invented inputs', async () => {
  for (const [args, expected] of [
    [['assemble', '--story-dir', 'workspace', '--intro', 'intro.mp4'], { storyDirectory: 'workspace', introPath: 'intro.mp4' }],
    [['assemble', '--story-dir', 'workspace', '--outro', 'outro.mp4'], { storyDirectory: 'workspace', outroPath: 'outro.mp4' }],
    [['assemble', '--story-dir', 'workspace'], { storyDirectory: 'workspace' }],
  ] as const) {
    await runCli(args, { writeStdout: () => undefined, writeStderr: () => undefined }, { assembleStory: async (input) => {
      assert.deepEqual(input, expected);
      return { status: 'final_ready', storyRunId: 'story-123', assemblyRunId: 'assembly-123', finalPath: 'final/clip.mp4', finalSha256: 'a'.repeat(64), durationSeconds: 40 };
    } });
  }
  assert.match(helpText, /\[--intro <intro-video-path>\]/);
  assert.match(helpText, /Optional local standardized intro/i);
});

test('CLI delegates media generation and reports safe counts', async () => {
  const stdout: string[] = [];
  const code = await runCli(['media', '--story-dir', 'workspace', '--anchor-reference', 'anchor.png'], {
    writeStdout: (text) => stdout.push(text), writeStderr: () => undefined,
  }, {
    generateMedia: async (dependencies) => {
      assert.deepEqual(dependencies.anchorReferencePaths, ['anchor.png']);
      return { status: 'media_ready', storyRunId: 'media-123', generatedUnitCount: 2, reusedUnitCount: 3, manifestPath: 'workspace/generated-media.json' };
    },
  });
  assert.equal(code, 0);
  assert.match(stdout.join(''), /media_ready/);
  assert.match(stdout.join(''), /generated: 2/);
  assert.match(helpText, /raw generated assets/i);
});

test('CLI delegates manual planning and exposes the persisted ClipPlan location', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let received: Record<string, string | undefined> | undefined;
  const exitCode = await runCli([
    'plan', '--input-file', 'fixture.json', '--article-id', 'article-2', '--artifacts-root', 'temp-stories',
  ], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
  }, {
    planStory: async (dependencies) => {
      received = dependencies;
      return {
        story: { storyRunId: 'plan-123' } as never,
        clipPlan: {
          storyFingerprint: 'c'.repeat(64), template: { id: 'default-news-40s', version: '2' },
        } as never,
        clipPlanPath: 'temp-stories/plan-123/clip-plan.json',
        clipPlanRunPath: 'temp-stories/plan-123/clip-plan-run.json',
        provider: 'fake', model: 'fake-model',
      };
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(received, {
    inputFile: 'fixture.json', articleId: 'article-2', artifactsRoot: 'temp-stories',
  });
  assert.match(stdout.join(''), /clip_plan_ready/);
  assert.match(stdout.join(''), /clip-plan\.json/);
  assert.match(helpText, /vidgen plan --input-file/);
  assert.deepEqual(stderr, []);
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
        template: { id: 'default-news-40s', version: '2' },
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
