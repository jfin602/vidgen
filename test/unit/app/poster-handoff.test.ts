import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runPosterCommand } from '../../../src/app/poster-handoff.ts';

test('Poster handoff runs the configured external CLI with discrete shell-free arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-poster-boundary-')); const output = join(root, 'arguments.json');
  const previousRoot = process.env.VIDGEN_POSTER_ROOT; const previousOutput = process.env.VIDGEN_POSTER_TEST_OUTPUT;
  try {
    await mkdir(join(root, 'src')); await writeFile(join(root, 'src', 'cli.ts'), "import { writeFile } from 'node:fs/promises'; await writeFile(process.env.VIDGEN_POSTER_TEST_OUTPUT!, JSON.stringify(process.argv.slice(2))); console.log('Bearer raw-child-output');");
    process.env.VIDGEN_POSTER_ROOT = root; process.env.VIDGEN_POSTER_TEST_OUTPUT = output;
    await runPosterCommand(['post', 'x', '--video', 'clip; $(unsafe).mp4', '--text', '"quoted" $HOME & text']);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), ['post', 'x', '--video', 'clip; $(unsafe).mp4', '--text', '"quoted" $HOME & text']);
  } finally {
    if (previousRoot === undefined) delete process.env.VIDGEN_POSTER_ROOT; else process.env.VIDGEN_POSTER_ROOT = previousRoot;
    if (previousOutput === undefined) delete process.env.VIDGEN_POSTER_TEST_OUTPUT; else process.env.VIDGEN_POSTER_TEST_OUTPUT = previousOutput;
    await rm(root, { recursive: true, force: true });
  }
});
