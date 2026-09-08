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
  assert.deepEqual(parseCliArgs(['headline', '--dry-run', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf']), { kind: 'headline', inputFile: 'fixture.json', articleId: 'article-2', maxSeconds: 20, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf', dryRun: true });
  assert.deepEqual(parseCliArgs(['headline', '--verbose', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf']), { kind: 'headline', inputFile: 'fixture.json', articleId: 'article-2', maxSeconds: 20, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf', verbose: true });
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
  assert.throws(() => parseCliArgs(['headline', '--input-file', 'fixture.json', '--article-id', 'article-1', '--anchor-reference', 'a', '--font-file', 'font.ttf', '--dry-run', '--dry-run']), /must not be repeated/);
  assert.throws(() => parseCliArgs(['headline', '--input-file', 'fixture.json', '--article-id', 'article-1', '--anchor-reference', 'a', '--font-file', 'font.ttf', '--dry-run', 'value']), /Unknown headline argument/);
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

test('headline verbose forwards safe pipeline progress while normal headline output stays concise', async () => {
  const run = async (verbose: boolean) => {
    const stdout: string[] = [];
    const code = await runCli(['headline', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf', ...(verbose ? ['--verbose'] : [])], { writeStdout: (text) => stdout.push(text), writeStderr: () => undefined }, {
      generateHeadline: async (input) => {
        input.onProgress?.('Veo generation starting.'); input.onProgress?.('Veo operation 1 pending (poll 1).');
        return { clipId: 'headline-1', finalPath: 'clip.mp4', metadataPath: 'clip.json', sha256: 'a'.repeat(64), durationSeconds: 4 };
      },
    });
    assert.equal(code, 0); return stdout.join('');
  };
  assert.match(await run(true), /Veo operation 1 pending \(poll 1\)/);
  assert.doesNotMatch(await run(false), /Veo generation starting/);
});

test('headline dry run delegates the value-less flag and never reports final media', async () => {
  const stdout: string[] = []; let receivedDryRun = false;
  const code = await runCli(['headline', '--dry-run', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf'], { writeStdout: (text) => stdout.push(text), writeStderr: () => undefined }, {
    generateHeadline: async (input) => { receivedDryRun = input.dryRun === true; return { dryRun: true, clipId: 'headline-1', presenterTextPath: 'headline-1.dry-run.txt', metadataPath: 'headline-1.dry-run.json', speechPlanningDurationSeconds: 4 }; },
  });
  const output = stdout.join(''); assert.equal(code, 0); assert.equal(receivedDryRun, true); assert.match(output, /dry_run_ready/); assert.match(output, /presenterText: headline-1\.dry-run\.txt/); assert.match(output, /speechPlanningDurationSeconds: 4/); assert.doesNotMatch(output, /plannedDurationSeconds|final:|sha256:|\.mp4/);
});

test('headline-post parses one, two, and three ordered platform values', () => {
  const base = ['--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf'];
  for (const [platforms, expected] of [
    [['x'], ['x']],
    [['x', 'meta'], ['x', 'meta']],
    [['bluesky', 'x'], ['bluesky', 'x']],
    [['bluesky', 'meta', 'x'], ['bluesky', 'meta', 'x']],
  ] as const) {
    const args = ['headline-post', ...base, ...platforms.flatMap((platform) => ['--platform', platform])];
    assert.deepEqual(parseCliArgs(args).platforms, expected);
  }
  assert.match(helpText, /headline-post/);
});

test('headline-post rejects invalid platform lists before any work', async () => {
  const base = ['headline-post', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf'];
  for (const suffix of [[], ['--platform', 'x', '--platform', 'x'], ['--platform', 'x,meta'], ['--platform', ''], ['--platform', 'mastodon'], ['--platform', 'x', '--platform', 'meta', '--platform', 'bluesky', '--platform', 'x']]) {
    let generated = 0; let poster = 0;
    const code = await runCli([...base, ...suffix], { writeStdout: () => undefined, writeStderr: () => undefined }, {
      generateHeadline: async () => { generated += 1; throw new Error('must not generate'); },
      runPoster: async () => { poster += 1; throw new Error('must not run'); },
    });
    assert.equal(code, 2); assert.equal(generated, 0); assert.equal(poster, 0);
  }
});

test('headline-post doctors all platforms before one generation, then posts only the final FFmpeg MP4 and exact caption in order', async () => {
  const calls: string[][] = []; let generated = 0;
  const code = await runCli(headlinePostArgs(['x', 'meta', 'bluesky']), { writeStdout: () => undefined, writeStderr: () => undefined }, {
    runPoster: async (args) => { calls.push([...args]); },
    generateHeadline: async () => { generated += 1; assert.deepEqual(calls, [['doctor', 'x'], ['doctor', 'meta'], ['doctor', 'bluesky']]); return completedHeadline('finished path; safe.mp4', 'A "quoted" headline; $HOME', 'Source & Co'); },
  });
  assert.equal(code, 0); assert.equal(generated, 1);
  assert.deepEqual(calls, [
    ['doctor', 'x'], ['doctor', 'meta'], ['doctor', 'bluesky'],
    ['post', 'x', '--video', 'finished path; safe.mp4', '--text', '"A "quoted" headline; $HOME" by Source & Co'],
    ['post', 'meta', '--video', 'finished path; safe.mp4', '--text', '"A "quoted" headline; $HOME" by Source & Co'],
    ['post', 'bluesky', '--video', 'finished path; safe.mp4', '--text', '"A "quoted" headline; $HOME" by Source & Co'],
  ]);
});

test('headline-post doctor failure prevents generation and all posts', async () => {
  const calls: string[][] = []; let generated = 0;
  const code = await runCli(headlinePostArgs(['bluesky', 'x']), { writeStdout: () => undefined, writeStderr: () => undefined }, {
    runPoster: async (args) => { calls.push([...args]); if (args[1] === 'x') throw new Error('raw token must stay private'); },
    generateHeadline: async () => { generated += 1; return completedHeadline(); },
  });
  assert.equal(code, 2); assert.equal(generated, 0); assert.deepEqual(calls, [['doctor', 'bluesky'], ['doctor', 'x']]);
});

test('headline-post dry run doctors platforms and generates P1 inspection state once without posting', async () => {
  const calls: string[][] = []; let generated = 0;
  const code = await runCli([...headlinePostArgs(['x', 'meta']), '--dry-run'], { writeStdout: () => undefined, writeStderr: () => undefined }, {
    runPoster: async (args) => { calls.push([...args]); },
    generateHeadline: async (input) => { generated += 1; assert.equal(input.dryRun, true); return { dryRun: true, clipId: 'headline-1', presenterTextPath: 'headline-1.dry-run.txt', metadataPath: 'headline-1.dry-run.json', speechPlanningDurationSeconds: 4 }; },
  });
  assert.equal(code, 0); assert.equal(generated, 1); assert.deepEqual(calls, [['doctor', 'x'], ['doctor', 'meta']]);
});

test('headline-post continues after a failed post, keeps later attempts, and reports no child diagnostic', async () => {
  const stdout: string[] = []; const stderr: string[] = []; const calls: string[][] = [];
  const code = await runCli(headlinePostArgs(['x', 'meta', 'bluesky']), { writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) }, {
    runPoster: async (args) => { calls.push([...args]); if (args[0] === 'post' && args[1] === 'meta') throw new Error('Bearer secret-child-output'); },
    generateHeadline: async () => completedHeadline('finished.mp4'),
  });
  assert.equal(code, 2); assert.deepEqual(calls.slice(-3).map((args) => args[1]), ['x', 'meta', 'bluesky']);
  assert.match(stdout.join(''), /Poster x: published\.|Poster meta: failed\.|Poster bluesky: published\./); assert.match(stdout.join(''), /final: finished\.mp4/); assert.doesNotMatch(`${stdout.join('')}${stderr.join('')}`, /secret-child-output/);
});

test('headline-post generation failure never posts', async () => {
  const calls: string[][] = [];
  const code = await runCli(headlinePostArgs(['x']), { writeStdout: () => undefined, writeStderr: () => undefined }, {
    runPoster: async (args) => { calls.push([...args]); },
    generateHeadline: async () => { throw new VidGenError('simple_clip', 'Headline generation failed safely.'); },
  });
  assert.equal(code, 2); assert.deepEqual(calls, [['doctor', 'x']]);
});

test('headline failure renders only explicit safe provider diagnostics', async () => {
  const stderr: string[] = []; const token = 'secret-access-token';
  const code = await runCli(['headline', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf'], { writeStdout: () => undefined, writeStderr: (text) => stderr.push(text) }, {
    generateHeadline: async () => { throw new VidGenError('generated_media', 'Agent Platform Veo video generation failed.', { cause: { authorization: `Bearer ${token}` }, safeProviderDiagnostic: { providerCode: 3, providerStatus: 'INVALID_ARGUMENT', supportCode: '15236754', providerMessage: 'Request rejected by provider.' } }); },
  });
  const output = stderr.join(''); assert.equal(code, 2); assert.match(output, /providerCode: 3/); assert.match(output, /providerStatus: INVALID_ARGUMENT/); assert.match(output, /supportCode: 15236754/); assert.match(output, /providerMessage: Request rejected by provider\./); assert.doesNotMatch(output, new RegExp(token)); assert.doesNotMatch(output, /\{"authorization"/);
});

test('headline verbose renders only sanitized Veo runtime diagnostics', async () => {
  const run = async (verbose: boolean) => {
    const stderr: string[] = []; const token = 'secret-access-token'; const prompt = 'Secret presenter dialogue.';
    const code = await runCli(['headline', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf', ...(verbose ? ['--verbose'] : [])], { writeStdout: () => undefined, writeStderr: (text) => stderr.push(text) }, {
      generateHeadline: async () => { throw new VidGenError('generated_media', 'Agent Platform Veo result processing failed.', { cause: new RangeError(`Bearer ${token} ${prompt} C:\\private\\response.json`), safeProviderDiagnostic: { veoStage: 'result_decode', internalError: 'RangeError', internalMessage: `Bearer ${token} ${prompt} C:\\private\\response.json` } }); },
    });
    const output = stderr.join(''); assert.equal(code, 2); assert.doesNotMatch(output, new RegExp(token)); assert.doesNotMatch(output, new RegExp(prompt)); assert.doesNotMatch(output, /C:\\private/); return output;
  };
  const verbose = await run(true); assert.match(verbose, /veoStage: result_decode/); assert.match(verbose, /internalError: RangeError/); assert.match(verbose, /internalMessage: Internal runtime error\./);
  assert.doesNotMatch(await run(false), /veoStage|internalError|internalMessage/);
});

function headlinePostArgs(platforms: readonly string[]) { return ['headline-post', '--input-file', 'fixture.json', '--article-id', 'article-2', '--anchor-reference', 'anchor.png', '--font-file', 'font.ttf', ...platforms.flatMap((platform) => ['--platform', platform])]; }
function completedHeadline(finalPath = 'clip.mp4', headline = 'A governed headline', sourceDisplayName = 'Example News') { return { clipId: 'headline-1', rawVeoPath: 'raw-veo-only.mp4', finalPath, metadataPath: 'clip.json', sha256: 'a'.repeat(64), durationSeconds: 4, headline, sourceDisplayName }; }
