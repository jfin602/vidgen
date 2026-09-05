import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import * as core from '../../scripts/codex-phase-core.mjs';
// @ts-expect-error The runner intentionally ships as native ESM JavaScript.
import * as cli from '../../scripts/codex-phase.mjs';

const {
  MODEL_CONFIGS,
  applyEventObservation,
  assertPostPrompt,
  assertVersionCompatible,
  buildPlan,
  createDisplaySession,
  createEventTracker,
  createStructuredEventProcessor,
  detectCompletedPromptPrefix,
  formatUsage,
  hasCursorControls,
  interpretEvent,
  isColorEnabled,
  isAscii,
  parsePrompt,
  printableAscii,
  promptCommitSubject,
  renderCloseoutFinalResponse,
  renderDashboard,
  renderFailureSummary,
  renderSuccessHandoff,
  resolveModelConfig,
  roadmapFamilyLabel,
  roadmapVersionFor,
  startElapsedRedraw,
  stripAnsi,
} = core;
const {
  buildCodexArguments,
  buildCodexExecutionPrompt,
  assertCodexVersionCompatible,
  checkCodexLauncher,
  compareNumericVersions,
  commitPromptChanges,
  handleFailure,
  MINIMUM_GPT_5_6_CODEX_VERSION,
  parseCodexCliVersion,
  invokeGit,
  resolveCodexLauncher,
  runCodex,
  runCli,
} = cli;

const directTestLauncher = Object.freeze({
  command: 'codex-test',
  prefixArguments: Object.freeze([]),
  type: 'test',
  identity: 'injected test launcher',
});
const compatibleCodexVersion = 'codex-cli 0.147.0';

const resolveTestNpmLauncher = (
  checkLauncher: (launcher: {
    command: string;
    prefixArguments: readonly string[];
    type: string;
  }) => string = () => 'codex-cli 0.147.0',
) => {
  const shimRoot = 'C:\\npm';
  const shim = `${shimRoot}\\codex.cmd`;
  const entrypoint = `${shimRoot}\\node_modules\\@openai\\codex\\bin\\codex.js`;
  const packageFile = `${shimRoot}\\node_modules\\@openai\\codex\\package.json`;
  const normalized = (value: string) => value.toLowerCase();
  return resolveCodexLauncher({
    platform: 'win32',
    findWindowsCommands: () => [shim],
    fileExists: async (file: string) =>
      normalized(file) === normalized(entrypoint),
    readTextFile: async (file: string) => {
      if (normalized(file) === normalized(shim)) {
        return '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
      }
      if (normalized(file) === normalized(packageFile)) {
        return JSON.stringify({
          name: '@openai/codex',
          bin: { codex: 'bin/codex.js' },
        });
      }
      throw new Error(`Unexpected test read: ${file}`);
    },
    checkLauncher,
  });
};

interface PromptOptions {
  closeout?: boolean;
  config?: string;
  title?: string;
  version?: string;
}

const prompt = (
  number: number,
  {
    config = 'Terra High',
    version = `0.8.${number}`,
    closeout = false,
    title = closeout ? 'Phase 8 closeout validation' : `Task ${number}`,
  }: PromptOptions = {},
) => ({
  filename: `P${number}-${closeout ? 'phase-8-closeout' : `task-${number}`}.txt`,
  text: `TASK: Phase 8 / P${number} — ${title}\n\nMODEL / REASONING / USAGE\n- Recommended configuration: \`${config}\`.\n\nVERSIONING\n- This prompt's assigned project version is \`${version}\`.\n\nGOAL\n${closeout ? 'Perform Phase 8 closeout.' : 'Implement the task.'}\n`,
});

const post1Prompt = (
  number: number,
  {
    phase = 0,
    version = `1.${phase}.${number}`,
    ...options
  }: PromptOptions & { phase?: number } = {},
) => {
  const entry = prompt(number, { ...options, version });
  return {
    ...entry,
    text: entry.text.replace('TASK: Phase 8', `TASK: Phase ${phase}`),
  };
};

const post2Prompt = (
  number: number,
  {
    phase = 1,
    version = `2.${phase}.${number}`,
    ...options
  }: PromptOptions & { phase?: number } = {},
) => {
  const entry = prompt(number, { ...options, version });
  return {
    ...entry,
    text: entry.text.replace('TASK: Phase 8', `TASK: Phase ${phase}`),
  };
};

const correctionPrompt = (
  number: number,
  {
    config = 'Terra High',
    version = '0.10.0',
    closeout = false,
    title = closeout
      ? 'Single-Publication correction closeout'
      : `Correction ${number}`,
  }: PromptOptions = {},
) => ({
  filename: `P${number}-${closeout ? 'correction-closeout' : `correction-${number}`}.txt`,
  text: `TASK: Correction 10 / P${number} — ${title}\n\nMODEL / REASONING / USAGE\n- Recommended configuration: \`${config}\`.\n\nVERSIONING\n- Required unchanged project version: \`${version}\`.\n\nGOAL\n${closeout ? 'Close only the correction gate.' : 'Implement the correction.'}\n`,
});

const gitResult = (rootDirectory: string, arguments_: string[]) => {
  const result = spawnSync('git', arguments_, {
    cwd: rootDirectory,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    `git ${arguments_.join(' ')} failed: ${result.stderr}`,
  );
  return String(result.stdout ?? '').trim();
};

const commitMessage = (rootDirectory: string, revision = 'HEAD') => {
  const object = spawnSync('git', ['cat-file', 'commit', revision], {
    cwd: rootDirectory,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(object.status, 0, String(object.stderr));
  const raw = String(object.stdout);
  return raw.slice(raw.indexOf('\n\n') + 2);
};

const createPhaseRepository = async (
  implementationCount = 2,
  config = 'Terra High',
) => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), 'vidgen-phase-git-test-'),
  );
  await mkdir(path.join(rootDirectory, 'docs', 'tasks', 'p8'), {
    recursive: true,
  });
  await writeFile(
    path.join(rootDirectory, 'package.json'),
    `${JSON.stringify({ name: 'phase-test', version: '0.8.0' }, null, 2)}\n`,
  );
  await writeFile(
    path.join(rootDirectory, '.gitignore'),
    '.codex-runs/\npackage-lock.json\n.env*\n',
  );
  for (let number = 1; number <= implementationCount; number += 1) {
    const entry = prompt(number, { config });
    await writeFile(
      path.join(rootDirectory, 'docs', 'tasks', 'p8', entry.filename),
      entry.text,
    );
  }
  const closeout = prompt(implementationCount + 1, { closeout: true, config });
  await writeFile(
    path.join(rootDirectory, 'docs', 'tasks', 'p8', closeout.filename),
    closeout.text,
  );
  gitResult(rootDirectory, ['init', '--quiet']);
  gitResult(rootDirectory, ['config', 'user.name', 'Runner Test']);
  gitResult(rootDirectory, ['config', 'user.email', 'runner@example.invalid']);
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', 'baseline']);
  return rootDirectory;
};

const createCorrectionRepository = async (implementationCount = 2) => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), 'vidgen-correction-git-test-'),
  );
  const folderName = 'c10-single-publication';
  await mkdir(path.join(rootDirectory, 'docs', 'tasks', folderName), {
    recursive: true,
  });
  await writeFile(
    path.join(rootDirectory, 'package.json'),
    `${JSON.stringify({ name: 'correction-test', version: '0.10.0' }, null, 2)}\n`,
  );
  await writeFile(
    path.join(rootDirectory, '.gitignore'),
    '.codex-runs/\npackage-lock.json\n.env*\n',
  );
  for (let number = 1; number <= implementationCount; number += 1) {
    const entry = correctionPrompt(number);
    await writeFile(
      path.join(rootDirectory, 'docs', 'tasks', folderName, entry.filename),
      entry.text,
    );
  }
  const closeout = correctionPrompt(implementationCount + 1, {
    closeout: true,
  });
  await writeFile(
    path.join(rootDirectory, 'docs', 'tasks', folderName, closeout.filename),
    closeout.text,
  );
  gitResult(rootDirectory, ['init', '--quiet']);
  gitResult(rootDirectory, ['config', 'user.name', 'Runner Test']);
  gitResult(rootDirectory, ['config', 'user.email', 'runner@example.invalid']);
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', 'baseline']);
  return rootDirectory;
};

const createPost2PhaseRepository = async (implementationCount = 1) => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), 'vidgen-post-2-phase-git-test-'),
  );
  const folderName = 'p2-1';
  await mkdir(path.join(rootDirectory, 'docs', 'tasks', folderName), {
    recursive: true,
  });
  await writeFile(
    path.join(rootDirectory, 'package.json'),
    `${JSON.stringify({ name: 'post-2-phase-test', version: '2.1.0' }, null, 2)}\n`,
  );
  await writeFile(
    path.join(rootDirectory, '.gitignore'),
    '.codex-runs/\npackage-lock.json\n.env*\n',
  );
  for (let number = 1; number <= implementationCount; number += 1) {
    const entry = post2Prompt(number);
    await writeFile(
      path.join(rootDirectory, 'docs', 'tasks', folderName, entry.filename),
      entry.text,
    );
  }
  const closeout = post2Prompt(implementationCount + 1, { closeout: true });
  await writeFile(
    path.join(rootDirectory, 'docs', 'tasks', folderName, closeout.filename),
    closeout.text,
  );
  gitResult(rootDirectory, ['init', '--quiet']);
  gitResult(rootDirectory, ['config', 'user.name', 'Runner Test']);
  gitResult(rootDirectory, ['config', 'user.email', 'runner@example.invalid']);
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', 'baseline']);
  return rootDirectory;
};

const commitRoadmapCompletion = async (
  rootDirectory: string,
  number: number,
) => {
  await writeFile(
    path.join(rootDirectory, 'package.json'),
    `${JSON.stringify({ name: 'phase-test', version: `0.8.${number}` }, null, 2)}\n`,
  );
  await writeFile(
    path.join(rootDirectory, `historical-P${number}.txt`),
    `completed ${number}\n`,
  );
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', `0.8.${number}`]);
  return gitResult(rootDirectory, ['rev-parse', 'HEAD']);
};

const commitPost2RoadmapCompletion = async (
  rootDirectory: string,
  number: number,
) => {
  await writeFile(
    path.join(rootDirectory, 'package.json'),
    `${JSON.stringify({ name: 'post-2-phase-test', version: `2.1.${number}` }, null, 2)}\n`,
  );
  await writeFile(
    path.join(rootDirectory, `post-2-P${number}.txt`),
    `completed ${number}\n`,
  );
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', `2.1.${number}`]);
  return gitResult(rootDirectory, ['rev-parse', 'HEAD']);
};

const commitUnrelated = async (rootDirectory: string, name: string) => {
  await writeFile(path.join(rootDirectory, `${name}.txt`), `${name}\n`);
  gitResult(rootDirectory, ['add', '-A']);
  gitResult(rootDirectory, ['commit', '--quiet', '-m', name]);
};

const testOutput = (interactive = false) => {
  let value = '';
  return {
    isTTY: interactive,
    write(chunk: string) {
      value += chunk;
      return true;
    },
    read: () => value,
  };
};

test('resolves every repository recommendation to its verified concrete CLI configuration', () => {
  const expected: Record<string, { model: string; reasoning: string }> = {
    'Luna Medium': { model: 'gpt-5.6-luna', reasoning: 'medium' },
    'Luna High': { model: 'gpt-5.6-luna', reasoning: 'high' },
    'Terra Medium': { model: 'gpt-5.6-terra', reasoning: 'medium' },
    'Terra High': { model: 'gpt-5.6-terra', reasoning: 'high' },
    'Terra Ultra': { model: 'gpt-5.6-terra', reasoning: 'ultra' },
    'Sol Light': { model: 'gpt-5.6-sol', reasoning: 'low' },
    'Sol Medium': { model: 'gpt-5.6-sol', reasoning: 'medium' },
    'Sol High': { model: 'gpt-5.6-sol', reasoning: 'high' },
    'Sol Ultra': { model: 'gpt-5.6-sol', reasoning: 'ultra' },
  };

  assert.deepEqual(Object.keys(MODEL_CONFIGS), Object.keys(expected));
  for (const [label, config] of Object.entries(expected)) {
    assert.deepEqual(resolveModelConfig(label), config);
    assert.deepEqual(MODEL_CONFIGS[label], config);
  }
});

test('unknown recommendations still fail closed', () => {
  assert.throws(() => resolveModelConfig('Terra Max'), /Unknown/);
  assert.throws(
    () => parsePrompt('P1-task.txt', prompt(1, { config: 'Terra Max' }).text),
    /Unknown/,
  );
});

test('GPT-5.6 Codex CLI versions are parsed and compared numerically', () => {
  assert.deepEqual(parseCodexCliVersion('codex-cli 0.144.0'), [0, 144, 0]);
  assert.deepEqual(parseCodexCliVersion('codex-cli 0.147.3'), [0, 147, 3]);
  assert.equal(
    compareNumericVersions([0, 144, 0], MINIMUM_GPT_5_6_CODEX_VERSION),
    0,
  );
  assert.equal(
    compareNumericVersions([0, 145, 0], MINIMUM_GPT_5_6_CODEX_VERSION),
    1,
  );
  assert.equal(
    compareNumericVersions([0, 143, 9], MINIMUM_GPT_5_6_CODEX_VERSION),
    -1,
  );
  assert.equal(parseCodexCliVersion('codex-cli latest'), undefined);

  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  assert.doesNotThrow(() =>
    assertCodexVersionCompatible(plan, 'codex-cli 0.144.0'),
  );
  assert.doesNotThrow(() =>
    assertCodexVersionCompatible(plan, 'codex-cli 1.0.0'),
  );
  assert.throws(
    () => assertCodexVersionCompatible(plan, 'codex-cli 0.143.9'),
    /0\.143\.9.*>= 0\.144\.0/,
  );
  assert.throws(
    () => assertCodexVersionCompatible(plan, 'unparseable'),
    /Cannot verify GPT-5\.6 compatibility.*>= 0\.144\.0/,
  );
});

test('incompatible GPT-5.6 CLI versions fail before Codex or run artifacts', async () => {
  const rootDirectory = await createPhaseRepository(1, 'Luna Medium');
  let codexCalls = 0;
  try {
    for (const [version, expectedError] of [
      ['codex-cli 0.143.9', /0\.143\.9.*>= 0\.144\.0/],
      ['unparseable version', /Cannot verify GPT-5\.6 compatibility/],
    ] as const) {
      await assert.rejects(
        runCli(['p8'], {
          rootDirectory,
          stdout: testOutput(false),
          resolveLauncher: async () => ({
            launcher: directTestLauncher,
            version,
          }),
          runCodexProcess: async () => {
            codexCalls += 1;
            throw new Error('Codex must not run for an incompatible CLI.');
          },
        }),
        expectedError,
      );
    }
    assert.equal(codexCalls, 0);
    await assert.rejects(access(path.join(rootDirectory, '.codex-runs')));
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('resolves an invocable Windows native codex.exe before npm shims', async () => {
  const nativeExecutable = 'C:\\Tools\\Codex\\codex.exe';
  const checked: unknown[] = [];
  const resolution = await resolveCodexLauncher({
    platform: 'win32',
    findWindowsCommands: () => ['C:\\npm\\codex.cmd', nativeExecutable],
    checkLauncher: (launcher: unknown) => {
      checked.push(launcher);
      return 'codex-cli 0.147.0';
    },
  });

  assert.equal(resolution.launcher.command, nativeExecutable);
  assert.deepEqual(resolution.launcher.prefixArguments, []);
  assert.equal(resolution.launcher.type, 'windows-native');
  assert.equal(resolution.version, 'codex-cli 0.147.0');
  assert.equal(checked[0], resolution.launcher);
});

test('resolves a Windows npm shim to Node plus its verified package entrypoint', async () => {
  const resolution = await resolveTestNpmLauncher();

  assert.equal(resolution.launcher.command, process.execPath);
  assert.deepEqual(resolution.launcher.prefixArguments, [
    'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
  ]);
  assert.equal(resolution.launcher.type, 'windows-npm');
  assert.equal(Object.isFrozen(resolution.launcher), true);
  assert.equal(Object.isFrozen(resolution.launcher.prefixArguments), true);

  let invocation:
    { command: string; arguments: string[]; shell: boolean } | undefined;
  assert.equal(
    checkCodexLauncher(resolution.launcher, {
      spawnSyncProcess: (
        command: string,
        arguments_: string[],
        options: { shell: boolean },
      ) => {
        invocation = { command, arguments: arguments_, shell: options.shell };
        return { status: 0, stdout: 'codex-cli 0.147.0\n', stderr: '' };
      },
    }),
    'codex-cli 0.147.0',
  );
  assert.deepEqual(invocation, {
    command: process.execPath,
    arguments: [
      'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      '--version',
    ],
    shell: false,
  });
});

test('native and Unix preflight invocations remain direct and shell-free', async () => {
  const invocations: Array<{
    command: string;
    arguments: string[];
    shell: boolean;
  }> = [];
  const spawnSyncProcess = (
    command: string,
    arguments_: string[],
    options: { shell: boolean },
  ) => {
    invocations.push({ command, arguments: arguments_, shell: options.shell });
    return { status: 0, stdout: 'codex-cli 0.147.0\n', stderr: '' };
  };
  const native = await resolveCodexLauncher({
    platform: 'win32',
    findWindowsCommands: () => ['C:\\Tools\\codex.exe'],
    spawnSyncProcess,
  });
  const unix = await resolveCodexLauncher({
    platform: 'linux',
    spawnSyncProcess,
  });

  assert.equal(native.version, 'codex-cli 0.147.0');
  assert.equal(unix.version, 'codex-cli 0.147.0');
  assert.deepEqual(invocations, [
    {
      command: 'C:\\Tools\\codex.exe',
      arguments: ['--version'],
      shell: false,
    },
    { command: 'codex', arguments: ['--version'], shell: false },
  ]);
});

test('missing, ambiguous, and unusable Windows launchers fail closed', async () => {
  await assert.rejects(
    resolveCodexLauncher({
      platform: 'win32',
      findWindowsCommands: () => [],
    }),
    /cannot be resolved on Windows/,
  );
  await assert.rejects(
    resolveCodexLauncher({
      platform: 'win32',
      findWindowsCommands: () => [
        'C:\\first\\codex.cmd',
        'C:\\second\\codex.cmd',
      ],
    }),
    /cannot be resolved unambiguously/,
  );
  await assert.rejects(
    resolveCodexLauncher({
      platform: 'win32',
      findWindowsCommands: () => ['C:\\npm\\codex.cmd'],
      readTextFile: async () => '@ECHO off',
      fileExists: async () => false,
    }),
    /do not identify the @openai\/codex entrypoint/,
  );
});

test('failed native discovery falls back to one usable npm launcher', async () => {
  const checkedTypes: string[] = [];
  const resolution = await resolveCodexLauncher({
    platform: 'win32',
    nodeExecutable: 'C:\\node\\node.exe',
    findWindowsCommands: () => [
      'C:\\desktop\\codex',
      'C:\\desktop\\codex.exe',
      'C:\\npm\\codex.cmd',
    ],
    fileExists: async (file: string) => file.endsWith('codex.js'),
    readTextFile: async (file: string) =>
      file.endsWith('package.json')
        ? JSON.stringify({
            name: '@openai/codex',
            bin: { codex: 'bin/codex.js' },
          })
        : 'node_modules\\@openai\\codex\\bin\\codex.js',
    checkLauncher: (launcher: { type: string }) => {
      checkedTypes.push(launcher.type);
      if (launcher.type === 'windows-native') throw new Error('access denied');
      return 'codex-cli 0.147.0';
    },
  });

  assert.deepEqual(checkedTypes, ['windows-native', 'windows-npm']);
  assert.equal(resolution.launcher.type, 'windows-npm');
});

test('preflight reports failed shell-free launcher invocation actionably', () => {
  assert.throws(
    () =>
      checkCodexLauncher(directTestLauncher, {
        spawnSyncProcess: () => ({
          status: null,
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('spawn codex-test ENOENT'), {
            code: 'ENOENT',
          }),
        }),
      }),
    /cannot be invoked: spawn codex-test ENOENT/,
  );
});

test('orders prompt numbers numerically and excludes closeout from execution', () => {
  const plan = buildPlan(
    [
      prompt(10, { closeout: true }),
      ...Array.from({ length: 9 }, (_, index) => prompt(index + 1)),
    ].reverse(),
    'p8',
  );
  assert.equal(plan.prompts[1]!.number, 2);
  assert.equal(plan.prompts.at(-1)!.number, 10);
  assert.equal(plan.implementations.length, 9);
  assert.equal(plan.closeout.kind, 'closeout');
  assert.equal(Object.isFrozen(plan.prompts), true);
  assert.equal(Object.isFrozen(plan.implementations), true);
});

test('rejects duplicate, missing, and malformed prompt numbers', () => {
  assert.throws(
    () =>
      buildPlan(
        [
          prompt(1),
          { ...prompt(1), filename: 'P1-other.txt' },
          prompt(2, { closeout: true }),
        ],
        'p8',
      ),
    /Duplicate/,
  );
  assert.throws(
    () => buildPlan([prompt(1), prompt(3, { closeout: true })], 'p8'),
    /contiguous/,
  );
  assert.throws(
    () => buildPlan([{ filename: 'task.txt', text: prompt(1).text }], 'p8'),
    /one-based/,
  );
});

test('requires exactly one unambiguous final closeout', () => {
  assert.throws(() => buildPlan([prompt(1), prompt(2)], 'p8'), /Exactly one/);
  assert.throws(
    () =>
      parsePrompt(
        'P1-closeout.txt',
        prompt(1, { title: 'Implementation task' }).text,
      ),
    /Ambiguous/,
  );
  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  assert.equal(plan.implementations.length, 1);
  assert.equal(plan.closeout.number, 2);
});

test('version and package-lock invariants fail closed', () => {
  const parsed = parsePrompt(prompt(1).filename, prompt(1).text);
  assert.equal(parsed.mode, 'phase');
  if (parsed.mode !== 'phase') {
    throw new Error('Expected a phase prompt.');
  }
  assert.throws(
    () => assertVersionCompatible('0.8.9', parsed, '0.8.0'),
    /expected package version/i,
  );
  assert.throws(
    () =>
      assertPostPrompt({
        exitCode: 0,
        version: '0.8.1',
        prompt: parsed,
        packageLockExists: true,
      }),
    /package-lock/,
  );
  assert.throws(
    () =>
      assertPostPrompt({
        exitCode: 0,
        version: '0.8.0',
        prompt: parsed,
        packageLockExists: false,
      }),
    /Expected package version/,
  );

  const correction = parsePrompt(
    correctionPrompt(1).filename,
    correctionPrompt(1).text,
  );
  assert.equal(correction.mode, 'correction');
  if (correction.mode !== 'correction') {
    throw new Error('Expected a correction prompt.');
  }
  assert.throws(
    () => assertVersionCompatible('0.10.1', correction, '0.10.0'),
    /expected unchanged package version 0\.10\.0/,
  );
  assert.throws(
    () =>
      assertPostPrompt({
        exitCode: 0,
        version: '0.10.1',
        prompt: correction,
        packageLockExists: false,
      }),
    /Expected unchanged package version 0\.10\.0/,
  );
});

test('structured event lines are appended and observed in arrival order', async () => {
  const appended: string[] = [];
  const observed: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstAppendBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const processor = createStructuredEventProcessor({
    appendLine: async (line: string) => {
      if (line.includes('"sequence":1')) await firstAppendBlocked;
      appended.push(line.trim());
    },
    onEvent: async (event: { sequence: number }) => {
      observed.push(event.sequence);
    },
  });

  processor.push('{"sequence":1}\n{"sequence":2}\n');
  const finished = processor.finish();
  await Promise.resolve();
  assert.deepEqual(appended, []);
  releaseFirst?.();
  await finished;
  assert.deepEqual(appended, ['{"sequence":1}', '{"sequence":2}']);
  assert.deepEqual(observed, [1, 2]);
});

test('event processing fully settles before completion', async () => {
  let settled = false;
  let releaseEvent: (() => void) | undefined;
  const eventBlocked = new Promise<void>((resolve) => {
    releaseEvent = resolve;
  });
  const processor = createStructuredEventProcessor({
    appendLine: async () => undefined,
    onEvent: async () => {
      await eventBlocked;
      settled = true;
    },
  });
  processor.push('{"type":"turn.completed"}\n');
  let finishReturned = false;
  const finishing = processor.finish().then(() => {
    finishReturned = true;
  });
  await Promise.resolve();
  assert.equal(finishReturned, false);
  releaseEvent?.();
  await finishing;
  assert.equal(settled, true);
  assert.equal(finishReturned, true);
});

test('a malformed final partial JSONL event fails before completion', async () => {
  const processor = createStructuredEventProcessor({
    appendLine: async () => undefined,
    onEvent: async () => undefined,
  });
  processor.push('{"type":"turn.completed"}\n{"malformed"');
  await assert.rejects(processor.finish(), /Unusable structured Codex output/);
});

test('execution contract decorates normal roadmap and correction task text', () => {
  for (const taskText of [
    'TASK: Phase 8 / P1 — normal implementation',
    'TASK: Correction 8 / P1 — bounded repair',
  ]) {
    const executionPrompt = buildCodexExecutionPrompt(taskText);
    assert.match(executionPrompt, /^PHASE RUNNER EXECUTION CONTRACT\r?\n/);
    assert.match(executionPrompt, /Do not create Git commits\./);
    assert.match(executionPrompt, /runner-owned Git commit boundary\./);
    assert.ok(executionPrompt.endsWith(taskText));
  }
});

test('runCodex sends the preflight snapshot and uses native final-response capture', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'vidgen-runner-test-'),
  );
  try {
    const taskFile = path.join(temporaryDirectory, 'P1-task.txt');
    const originalText = 'captured preflight prompt';
    await writeFile(taskFile, originalText);
    const parsedPrompt = {
      number: 1,
      model: 'gpt-5.6-terra',
      reasoning: 'high',
      text: await readFile(taskFile, 'utf8'),
    };
    await writeFile(taskFile, 'mutated after preflight');

    let preflightLauncher: unknown;
    const resolution = await resolveTestNpmLauncher((launcher) => {
      preflightLauncher = launcher;
      return 'codex-cli 0.147.0';
    });
    let stdinText = '';
    let invocationCommand = '';
    let invocationArguments: string[] = [];
    let shell: boolean | undefined;
    const spawnProcess = (
      command: string,
      childArguments: string[],
      options: { shell: boolean },
    ) => {
      invocationCommand = command;
      invocationArguments = childArguments;
      shell = options.shell;
      const child = new EventEmitter() as EventEmitter & {
        stdin: { end(value: string): void };
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdin = {
        end(value: string) {
          stdinText = value;
        },
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        void (async () => {
          const outputIndex = childArguments.indexOf('--output-last-message');
          await writeFile(childArguments[outputIndex + 1]!, 'native final');
          child.stdout.write(
            '{"type":"turn.completed","usage":{"input_tokens":3}}\n',
          );
          child.emit('close', 0, null);
        })();
      });
      return child;
    };

    const seen: unknown[] = [];
    const result = await runCodex(
      parsedPrompt,
      temporaryDirectory,
      async (event: unknown) => {
        seen.push(event);
      },
      {
        launcher: resolution.launcher,
        rootDirectory: temporaryDirectory,
        spawnProcess,
      },
    );

    assert.equal(preflightLauncher, resolution.launcher);
    assert.equal(invocationCommand, resolution.launcher.command);
    assert.equal(
      invocationArguments[0],
      resolution.launcher.prefixArguments[0],
    );
    assert.equal(shell, false);
    assert.match(stdinText, /^PHASE RUNNER EXECUTION CONTRACT\r?\n/);
    assert.match(stdinText, /Do not create Git commits\./);
    assert.match(stdinText, /The phase runner exclusively owns:/);
    assert.ok(stdinText.endsWith(originalText));
    assert.equal(stdinText, buildCodexExecutionPrompt(originalText));
    assert.notEqual(stdinText, await readFile(taskFile, 'utf8'));
    assert.equal(result.finalResponse, 'native final');
    assert.equal(seen.length, 1);
    const outputIndex = invocationArguments.indexOf('--output-last-message');
    assert.notEqual(outputIndex, -1);
    assert.equal(invocationArguments.includes('--json'), true);
    assert.equal(
      await readFile(path.join(temporaryDirectory, 'P1.events.jsonl'), 'utf8'),
      '{"type":"turn.completed","usage":{"input_tokens":3}}\n',
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('runCodex rejects malformed output emitted immediately before child close', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'vidgen-runner-test-'),
  );
  try {
    const parsedPrompt = {
      number: 1,
      model: 'gpt-5.6-sol',
      reasoning: 'high',
      text: 'safe test prompt',
    };
    const spawnProcess = (_command: string, childArguments: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: { end(): void };
        stdout: PassThrough;
        stderr: PassThrough;
      };
      child.stdin = { end() {} };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        void (async () => {
          const outputIndex = childArguments.indexOf('--output-last-message');
          await writeFile(childArguments[outputIndex + 1]!, 'unused final');
          child.stdout.write('{"malformed"');
          child.emit('close', 0, null);
        })();
      });
      return child;
    };

    await assert.rejects(
      runCodex(parsedPrompt, temporaryDirectory, async () => undefined, {
        launcher: directTestLauncher,
        rootDirectory: temporaryDirectory,
        spawnProcess,
      }),
      /Unusable structured Codex output/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Codex arguments retain JSON events and exact model efforts', () => {
  const lunaMedium = prompt(1, { config: 'Luna Medium' });
  const lunaArguments = buildCodexArguments(
    parsePrompt(lunaMedium.filename, lunaMedium.text),
    'C:\\repo',
    'C:\\run\\final.txt',
  );
  assert.deepEqual(lunaArguments.slice(0, 6), [
    'exec',
    '--json',
    '--model',
    'gpt-5.6-luna',
    '-c',
    'model_reasoning_effort="medium"',
  ]);

  const ultra = prompt(1, { config: 'Sol Ultra' });
  const ultraArguments = buildCodexArguments(
    parsePrompt(ultra.filename, ultra.text),
    'C:\\repo',
    'C:\\run\\final.txt',
  );
  assert.deepEqual(ultraArguments.slice(0, 6), [
    'exec',
    '--json',
    '--model',
    'gpt-5.6-sol',
    '-c',
    'model_reasoning_effort="ultra"',
  ]);
  assert.deepEqual(ultraArguments.slice(6, 8), [
    '--output-last-message',
    'C:\\run\\final.txt',
  ]);
});

test('command lifecycle counts one logical command and tracks active elapsed time', () => {
  const tracker = createEventTracker();
  const started = interpretEvent({
    type: 'item.started',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm run test:integration',
      status: 'in_progress',
    },
  });
  applyEventObservation(tracker, started, 1_000);
  assert.equal(tracker.commands, 1);
  assert.equal(tracker.activeCommands.get('cmd-1').startedAt, 1_000);

  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const states = new Map([[1, { status: 'running' }]]);
  const output = renderDashboard({
    plan,
    states,
    current: plan.implementations[0],
    activity: '',
    tracker,
    startedAt: 1_000,
    now: 39_000,
  });
  assert.match(output, /Running: npm run test:integration/);
  assert.match(output, /elapsed 00:38/);

  const completed = interpretEvent({
    type: 'item.completed',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'npm run test:integration',
      status: 'completed',
    },
  });
  applyEventObservation(tracker, completed, 40_000);
  assert.equal(tracker.commands, 1);
  assert.equal(tracker.activeCommands.size, 0);
});

test('latest non-empty agent message persists independently through command and file activity', () => {
  const tracker = createEventTracker();
  const firstEvent = {
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Inspecting the persistence tests.' },
  };
  const first = interpretEvent(firstEvent);
  applyEventObservation(tracker, first);
  assert.equal(tracker.latestAgentMessage, firstEvent.item.text);

  applyEventObservation(
    tracker,
    interpretEvent({
      type: 'item.started',
      item: {
        id: 'cmd-agent-test',
        type: 'command_execution',
        command: 'npm run test:db',
        status: 'in_progress',
      },
    }),
  );
  applyEventObservation(
    tracker,
    interpretEvent({
      type: 'item.completed',
      item: { type: 'file_change', changes: [{ path: 'schema.sql' }] },
    }),
  );
  assert.equal(tracker.latestAgentMessage, firstEvent.item.text);

  const replacement = interpretEvent({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Running the focused tests now.' },
  });
  applyEventObservation(tracker, replacement);
  applyEventObservation(
    tracker,
    interpretEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: '   ' },
    }),
  );
  assert.equal(tracker.latestAgentMessage, 'Running the focused tests now.');

  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const output = renderDashboard({
    plan,
    states: new Map([[1, { status: 'running' }]]),
    current: plan.implementations[0],
    activity: '',
    tracker,
    startedAt: 0,
    now: 1_000,
  });
  assert.match(output, /Agent:\n {2}Running the focused tests now\./);
  assert.match(output, /Activity:\n {2}\[>\] Running: npm run test:db/);
});

test('normal agent presentation bounds whitespace and length without mutating event content', () => {
  const original = `  ${'complete narrative '.repeat(40)}\nwith final detail  `;
  const event = {
    type: 'item.completed',
    item: { type: 'agent_message', text: original },
  };
  const observation = interpretEvent(event);
  const tracker = createEventTracker();
  applyEventObservation(tracker, observation);
  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const output = renderDashboard({
    plan,
    states: new Map([[1, { status: 'running' }]]),
    current: plan.implementations[0],
    activity: '',
    tracker,
    startedAt: 0,
    terminalWidth: 80,
  });
  const agentBlock = output.match(/Agent:\n([\s\S]*?)\n\nActivity:/)?.[1] ?? '';
  assert.ok(agentBlock.split('\n').length <= 3);
  assert.ok(agentBlock.length <= 330);
  assert.match(agentBlock, /\.\.\.$/);
  assert.equal(observation.agentMessage, original);
  assert.equal(event.item.text, original);
  assert.equal(interpretEvent(event, true).activity, original);
});

test('interactive dashboard colors semantic states while disabled output stays plain', () => {
  const plan = buildPlan(
    [prompt(1), prompt(2), prompt(3), prompt(4, { closeout: true })],
    'p8',
  );
  const states = new Map([
    [1, { status: 'passed', commitSha: 'abc1234567890' }],
    [2, { status: 'running' }],
    [3, { status: 'failed' }],
  ]);
  const tracker = createEventTracker();
  applyEventObservation(
    tracker,
    interpretEvent({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Checking color semantics.' },
    }),
  );
  const colored = renderDashboard({
    plan,
    states,
    current: plan.implementations[1],
    activity: '[X] failed activity',
    tracker,
    startedAt: 0,
    colorEnabled: true,
  });
  const escape = String.fromCharCode(27);
  assert.ok(colored.includes(`${escape}[1;36mVIDGEN`));
  assert.ok(colored.includes(`${escape}[32m  [+] PASSED`));
  assert.ok(colored.includes(`${escape}[36m  [>] RUNNING`));
  assert.ok(colored.includes(`${escape}[31m  [X] FAILED`));
  assert.ok(colored.includes(`${escape}[33m  [M] MANUAL`));
  assert.ok(colored.includes(`${escape}[35mAgent:`));
  const styles = colored.match(new RegExp(`${escape}\\[[0-9;]*m`, 'g')) ?? [];
  assert.equal(styles.at(-1), `${escape}[0m`);

  const plain = renderDashboard({
    plan,
    states,
    current: plan.implementations[1],
    activity: '',
    tracker,
    startedAt: 0,
    colorEnabled: false,
  });
  assert.equal(stripAnsi(plain), plain);
  assert.match(plain, /\[\+\] PASSED/);
});

test('color eligibility requires TTY, non-verbose output, and absent NO_COLOR', () => {
  const hadNoColor = Object.hasOwn(process.env, 'NO_COLOR');
  const previousNoColor = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    assert.equal(isColorEnabled({ interactive: true }), true);
    assert.equal(isColorEnabled({ interactive: false }), false);
    assert.equal(isColorEnabled({ interactive: true, verbose: true }), false);

    process.env.NO_COLOR = '1';
    assert.equal(isColorEnabled({ interactive: true }), false);

    process.env.NO_COLOR = '';
    assert.equal(isColorEnabled({ interactive: true }), false);
  } finally {
    if (hadNoColor) process.env.NO_COLOR = previousNoColor;
    else delete process.env.NO_COLOR;
  }
});

test('display strips ANSI when color is disabled and counts styled redraw lines safely', () => {
  const plainOutput = testOutput(false);
  const plainDisplay = createDisplaySession({
    stream: plainOutput,
    interactive: false,
    colorEnabled: false,
  });
  plainDisplay.progress('\u001b[31m[X] failure\u001b[0m');
  assert.equal(plainOutput.read(), '[X] failure\n');

  const styledOutput = testOutput(true);
  const operations: string[] = [];
  const styledDisplay = createDisplaySession({
    stream: styledOutput,
    interactive: true,
    colorEnabled: true,
    moveCursorFunction: (_stream: unknown, x: number, y: number) =>
      operations.push(`move:${x}:${y}`),
    cursorToFunction: () => undefined,
    clearScreenDownFunction: () => undefined,
  });
  styledDisplay.render('\u001b[36mfirst\u001b[0m\nsecond\n');
  styledDisplay.render('\u001b[32mfinal\u001b[0m\n');
  assert.deepEqual(operations, ['move:0:-2']);
  const escape = String.fromCharCode(27);
  const styles =
    styledOutput.read().match(new RegExp(`${escape}\\[[0-9;]*m`, 'g')) ?? [];
  assert.equal(styles.at(-1), `${escape}[0m`);
});

test('completed prompt durations and observed usage remain rendered', () => {
  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const states = new Map([
    [
      1,
      {
        status: 'passed',
        durationMs: 402_000,
        commitSha: 'abc1234567890',
        usage: {
          input_tokens: 182_440,
          cached_input_tokens: 151_392,
          output_tokens: 8_714,
          reasoning_output_tokens: 5_821,
        },
      },
    ],
  ]);
  const output = renderDashboard({
    plan,
    states,
    current: undefined,
    activity: '',
    tracker: createEventTracker(),
    startedAt: 0,
    now: 0,
  });
  assert.match(output, /P1.+06:42/);
  assert.match(output, /Commit: abc1234/);
  assert.match(output, /Usage:/);
  assert.match(output, /Input\s+182440/);
  assert.match(output, /Cached\s+151392/);
  assert.match(output, /Output\s+8714/);
  assert.match(output, /Reasoning\s+5821/);
});

test('missing usage metadata is tolerated and omitted', () => {
  assert.deepEqual(formatUsage(undefined), []);
  assert.deepEqual(formatUsage({}), []);
  assert.deepEqual(formatUsage({ output_tokens: 9 }), [
    'Usage:',
    '  Output            9',
  ]);
});

test('elapsed redraw timer ticks and cleans up through injected timing functions', () => {
  let callback: (() => void) | undefined;
  let interval = 0;
  let cleared: unknown;
  let redraws = 0;
  const stop = startElapsedRedraw(
    () => {
      redraws += 1;
    },
    {
      setIntervalFunction: (next: () => void, milliseconds: number) => {
        callback = next;
        interval = milliseconds;
        return 'timer-id';
      },
      clearIntervalFunction: (timer: unknown) => {
        cleared = timer;
      },
    },
  );
  assert.equal(interval, 1_000);
  callback?.();
  callback?.();
  assert.equal(redraws, 2);
  stop();
  assert.equal(cleared, 'timer-id');
});

test('failure summary names failed, completed, not executed, and manual closeout prompts', () => {
  const plan = buildPlan(
    [prompt(1), prompt(2), prompt(3), prompt(4, { closeout: true })],
    'p8',
  );
  const states = new Map([
    [1, { status: 'passed', durationMs: 10 }],
    [2, { status: 'failed' }],
  ]);
  const output = renderFailureSummary({
    plan,
    states,
    failedPrompt: plan.prompts[1],
    reason: 'Expected package version: 0.8.2 — actual 0.8.1',
  });
  assert.match(output, /\[X\] P2 - Task 2/);
  assert.match(output, /Completed:\n\s{2}\[\+\] P1/);
  assert.match(output, /Not executed:\n\s{2}\[ \] P3/);
  assert.match(output, /\[M\] P4 - Phase 8 closeout validation - NOT EXECUTED/);
  assert.match(output, /No later Codex prompts were started/);
  assert.equal(isAscii(output), true);
});

test('failure summary reports previously completed resumed prompts as completed', () => {
  const plan = buildPlan(
    [prompt(1), prompt(2), prompt(3), prompt(4, { closeout: true })],
    'p8',
  );
  const states = new Map([
    [1, { status: 'previously_completed' }],
    [2, { status: 'failed' }],
    [3, { status: 'waiting' }],
  ]);
  const output = renderFailureSummary({
    plan,
    states,
    failedPrompt: plan.prompts[1],
    reason: 'Prompt failed.',
  });

  assert.match(output, /Completed:\n\s{2}\[\+\] P1/);
  assert.match(output, /\[X\] P2 - Task 2/);
  assert.match(output, /Not executed:\n\s{2}\[ \] P3/);
  assert.doesNotMatch(output, /Not executed:[\s\S]*\[ \] P1/);
  assert.match(output, /\[M\] P4 - Phase 8 closeout validation - NOT EXECUTED/);
  assert.equal(isAscii(output), true);
});

test('correction dashboard, failure, and handoff use fixed-version correction semantics', () => {
  const plan = buildPlan(
    [correctionPrompt(1), correctionPrompt(2, { closeout: true })],
    'c10-single-publication',
  );
  assert.equal(plan.mode, 'correction');
  const dashboard = renderDashboard({
    plan,
    states: new Map([[1, { status: 'running' }]]),
    current: plan.implementations[0],
    activity: '[.] Working',
    tracker: createEventTracker(),
    startedAt: 0,
    now: 1_000,
  });
  const failure = renderFailureSummary({
    plan,
    states: new Map([[1, { status: 'failed' }]]),
    failedPrompt: plan.implementations[0],
    reason: 'Expected unchanged package version 0.10.0; found 0.10.1.',
  });
  const handoff = renderSuccessHandoff(
    plan,
    '.codex-runs/c10-single-publication/test',
  );

  assert.match(dashboard, /Stack mode:\s+Correction/);
  assert.match(dashboard, /Correction:\s+c10-single-publication/);
  assert.match(dashboard, /Version:\s+0\.10\.0 \(UNCHANGED\)/);
  assert.doesNotMatch(dashboard, /Target:\s+0\.10\.1/);
  assert.match(failure, /CORRECTION STACK c10-single-publication STOPPED/);
  assert.match(
    handoff,
    /CORRECTION STACK c10-single-publication IMPLEMENTATION PROMPTS COMPLETE/,
  );
  assert.match(handoff, /Version: 0\.10\.0 \(UNCHANGED\)/);
  assert.match(handoff, /does not run \/closeout/);
  assert.match(handoff, /does not .*change package\.json/);
  assert.doesNotMatch(handoff, /Target:/);
});

test('parse-only validator reports correction identity and unchanged version without writes', async () => {
  const rootDirectory = await createCorrectionRepository(1);
  const validator = path.resolve('scripts', 'validate-codex-phase.mjs');
  try {
    const baselineHead = gitResult(rootDirectory, ['rev-parse', 'HEAD']);
    const result = spawnSync(
      process.execPath,
      [validator, 'c10-single-publication'],
      {
        cwd: rootDirectory,
        encoding: 'utf8',
        shell: false,
      },
    );

    assert.equal(result.status, 0, String(result.stderr));
    assert.match(
      String(result.stdout),
      /Correction stack c10-single-publication \(roadmap phase 10\) prompt grammar: VALID/,
    );
    assert.match(String(result.stdout), /Required unchanged version: 0\.10\.0/);
    assert.match(
      String(result.stdout),
      /P1 \| implementation \| Terra High \| 0\.10\.0 \(UNCHANGED\)/,
    );
    assert.doesNotMatch(String(result.stdout), /0\.10\.1/);
    assert.equal(gitResult(rootDirectory, ['rev-parse', 'HEAD']), baselineHead);
    assert.equal(gitResult(rootDirectory, ['status', '--porcelain=v1']), '');
    assert.equal(
      JSON.parse(
        await readFile(path.join(rootDirectory, 'package.json'), 'utf8'),
      ).version,
      '0.10.0',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('runner-owned metadata, activity, errors, and paths are ASCII-safe', () => {
  const plan = buildPlan(
    [
      prompt(1, { title: 'Pagination — café “résumé”' }),
      prompt(2, { closeout: true, title: 'Closeout — Clôseout…' }),
    ],
    'p8',
  );
  const output = renderDashboard({
    plan,
    states: new Map([[1, { status: 'running' }]]),
    current: plan.implementations[0],
    activity: '[>] Télémetry → running',
    tracker: createEventTracker(),
    startedAt: 0,
    now: 1_000,
  });
  const success = renderSuccessHandoff(plan, '.codex-runs/été');
  const failure = renderFailureSummary({
    plan,
    states: new Map(),
    failedPrompt: plan.implementations[0],
    reason: 'Échec — malformed…',
  });
  assert.equal(isAscii(output), true);
  assert.equal(isAscii(success), true);
  assert.equal(isAscii(failure), true);
  assert.equal(isAscii(printableAscii('“quoted” — café → done…')), true);
});

test('interactive display replaces its prior region and supports changing heights', () => {
  const output = testOutput(true);
  const operations: string[] = [];
  const display = createDisplaySession({
    stream: output,
    interactive: true,
    moveCursorFunction: (_stream: unknown, x: number, y: number) => {
      operations.push(`move:${x}:${y}`);
    },
    cursorToFunction: (_stream: unknown, x: number) => {
      operations.push(`cursor:${x}`);
    },
    clearScreenDownFunction: () => {
      operations.push('clear-owned-region');
    },
  });

  assert.equal(display.render('first\nsecond\nthird\n'), true);
  assert.equal(display.render('short\n'), true);
  assert.deepEqual(operations, ['move:0:-3', 'cursor:0', 'clear-owned-region']);
  assert.equal(output.read(), 'first\nsecond\nthird\nshort\n');
});

test('interactive elapsed redraws skip identical dashboards and use cursor controls without clearing history', () => {
  const output = testOutput(true);
  const display = createDisplaySession({ stream: output, interactive: true });
  assert.equal(display.render('Elapsed: 00:01\n'), true);
  assert.equal(display.render('Elapsed: 00:01\n'), false);
  assert.equal(display.render('Elapsed: 00:02\n'), true);
  assert.equal(hasCursorControls(output.read()), true);
  assert.equal(output.read().includes(`${String.fromCharCode(27)}[2J`), false);
  assert.equal((output.read().match(/Elapsed: 00:01/g) ?? []).length, 1);
  assert.equal((output.read().match(/Elapsed: 00:02/g) ?? []).length, 1);
});

test('non-TTY display emits bounded transitions with no dashboards or cursor controls', () => {
  const output = testOutput(false);
  const display = createDisplaySession({ stream: output, interactive: false });
  for (let index = 0; index < 100; index += 1) {
    assert.equal(display.render(`FULL DASHBOARD ${index}\n`), false);
  }
  display.progress('[.] Phase 8 started');
  display.progress('[>] P1 started');
  display.progress('[+] P1 passed - commit abc1234');
  display.finalize('FINAL DASHBOARD\n');

  assert.equal(hasCursorControls(output.read()), false);
  assert.doesNotMatch(output.read(), /FULL DASHBOARD|FINAL DASHBOARD/);
  assert.equal(output.read().split('\n').filter(Boolean).length, 3);
});

test('display finalization leaves one stable final dashboard and restores append-only output', () => {
  const output = testOutput(true);
  const display = createDisplaySession({ stream: output, interactive: true });
  display.render('RUNNING\n');
  assert.equal(display.finalize('FINAL\n'), true);
  assert.equal(display.render('SHOULD NOT RENDER\n'), false);
  output.write('HANDOFF\n');
  assert.equal((output.read().match(/FINAL/g) ?? []).length, 1);
  assert.doesNotMatch(output.read(), /SHOULD NOT RENDER/);
  assert.match(output.read(), /HANDOFF\n$/);
});

test('display session keeps runner output ASCII-safe while leaving source content untouched', () => {
  const output = testOutput(false);
  const display = createDisplaySession({ stream: output, interactive: false });
  const source = 'Résumé — 東京';
  display.progress(source);
  assert.equal(isAscii(output.read()), true);
  assert.equal(source, 'Résumé — 東京');
});

test('phase loop commits each prompt before the next starts with exact multiline Unicode messages', async () => {
  const rootDirectory = await createPhaseRepository(2);
  const output = testOutput(false);
  const codexCalls: number[] = [];
  const gitInvocations: Array<{ arguments: string[]; shell: boolean }> = [];
  const responses = new Map([
    [1, 'Implemented P1.\n\nDetails: café — 東京\n'],
    [2, 'Implemented P2.\nSecond line.'],
  ]);
  try {
    const result = await runCli(['p8'], {
      rootDirectory,
      stdout: output,
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      spawnSyncProcess: (
        command: string,
        arguments_: string[],
        options: { shell: boolean },
      ) => {
        assert.equal(command, 'git');
        gitInvocations.push({
          arguments: [...arguments_],
          shell: options.shell,
        });
        return spawnSync(command, arguments_, {
          ...options,
          cwd: rootDirectory,
          encoding: 'utf8',
        });
      },
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        codexCalls.push(parsedPrompt.number);
        if (parsedPrompt.number === 2) {
          assert.equal(
            gitResult(rootDirectory, ['log', '-1', '--format=%s']),
            '0.8.1',
          );
          assert.equal(
            gitResult(rootDirectory, ['status', '--porcelain=v1']),
            '',
          );
        }
        await writeFile(
          path.join(rootDirectory, 'package.json'),
          `${JSON.stringify(
            {
              name: 'phase-test',
              version: `0.8.${parsedPrompt.number}`,
            },
            null,
            2,
          )}\n`,
        );
        await writeFile(
          path.join(
            rootDirectory,
            `P${parsedPrompt.number}-implementation.txt`,
          ),
          `change ${parsedPrompt.number}\n`,
        );
        return {
          code: 0,
          signal: null,
          finalResponse: responses.get(parsedPrompt.number),
          stderr: '',
          childArgs: [],
        };
      },
    });

    assert.equal(result, 0);
    assert.deepEqual(codexCalls, [1, 2]);
    assert.deepEqual(
      gitResult(rootDirectory, ['log', '-2', '--format=%s']).split('\n'),
      ['0.8.2', '0.8.1'],
    );
    assert.equal(
      commitMessage(rootDirectory, 'HEAD~1'),
      `0.8.1\n\n${responses.get(1)}`,
    );
    assert.equal(
      commitMessage(rootDirectory, 'HEAD'),
      `0.8.2\n\n${responses.get(2)}`,
    );
    assert.equal(gitResult(rootDirectory, ['status', '--porcelain=v1']), '');
    assert.equal(
      gitInvocations.every((invocation) => invocation.shell === false),
      true,
    );
    assert.equal(
      gitInvocations.some((invocation) =>
        invocation.arguments.includes('push'),
      ),
      false,
    );
    const commitCalls = gitInvocations.filter(
      ({ arguments: arguments_ }) => arguments_[0] === 'commit',
    );
    assert.equal(commitCalls.length, 2);
    assert.equal(
      commitCalls.every(
        ({ arguments: arguments_ }) =>
          arguments_.includes('--file') &&
          !arguments_.some((argument) => argument.includes('Implemented P')),
      ),
      true,
    );
    const runFolders = await readdir(
      path.join(rootDirectory, '.codex-runs', 'p8'),
    );
    assert.equal(runFolders.length, 1);
    const runDirectory = path.join(
      rootDirectory,
      '.codex-runs',
      'p8',
      runFolders[0]!,
    );
    const run = JSON.parse(
      await readFile(path.join(runDirectory, 'run.json'), 'utf8'),
    );
    assert.match(run.prompts[0].commitSha, /^[0-9a-f]{40,64}$/);
    assert.match(run.prompts[1].commitSha, /^[0-9a-f]{40,64}$/);
    assert.equal(run.prompts[2].status, 'manual');
    assert.equal(
      await readFile(path.join(runDirectory, 'P1.commit-message.txt'), 'utf8'),
      `0.8.1\n\n${responses.get(1)}`,
    );
    assert.match(output.read(), /P1 passed - commit [0-9a-f]{7}/);
    assert.match(output.read(), /P2 passed - commit [0-9a-f]{7}/);
    assert.doesNotMatch(output.read(), /VIDGEN - CODEX PHASE RUNNER/);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('resume planning selects the newest exact phase marker while preserving prefix and version safety', () => {
  const plan = buildPlan(
    [prompt(1), prompt(2), prompt(3), prompt(4, { closeout: true })],
    'p8',
  );
  assert.equal(
    detectCompletedPromptPrefix(plan, [], '0.8.0').completedCount,
    0,
  );
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [
          { sha: 'one', subject: '0.8.1' },
          { sha: 'three', subject: '0.8.3' },
        ],
        '0.8.1',
      ),
    /P3 is completed while P2 is missing/,
  );
  const duplicateResume = detectCompletedPromptPrefix(
    plan,
    [
      { sha: 'one-newest', subject: '0.8.1' },
      { sha: 'unrelated', subject: 'documentation update' },
      { sha: 'one-older', subject: '0.8.1' },
    ],
    '0.8.1',
  );
  assert.equal(duplicateResume.completedCount, 1);
  assert.equal(duplicateResume.completed[0]?.commitSha, 'one-newest');
  assert.equal(duplicateResume.nextPrompt?.number, 2);
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [{ sha: 'one', subject: '0.8.1' }],
        '0.8.2',
      ),
    /expected 0\.8\.1/,
  );
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [
          { sha: 'one', subject: '0.8.1' },
          { sha: 'two', subject: '0.8.2' },
        ],
        '0.8.1',
      ),
    /expected 0\.8\.2/,
  );
});

test('post-1.0 resume uses the normalized roadmap family for baselines and prefixes', () => {
  const plan = buildPlan(
    [post1Prompt(1), post1Prompt(2), post1Prompt(3, { closeout: true })],
    'p1-0',
  );
  assert.equal(plan.mode, 'phase');
  if (plan.mode !== 'phase') throw new Error('Expected a phase plan.');
  assert.equal(plan.roadmapFamily, 'post-1.0');
  assert.equal(plan.roadmapMajor, 1);

  const initial = detectCompletedPromptPrefix(plan, [], '1.0.0');
  assert.equal(initial.completedCount, 0);
  assert.equal(initial.previousVersion, '1.0.0');

  const resumed = detectCompletedPromptPrefix(
    plan,
    [
      { sha: 'unrelated', subject: 'documentation update' },
      { sha: 'one', subject: '1.0.1' },
    ],
    '1.0.1',
  );
  assert.equal(resumed.completedCount, 1);
  assert.equal(resumed.previousVersion, '1.0.1');
  assert.equal(resumed.nextPrompt?.mode, 'phase');
  if (resumed.nextPrompt?.mode !== 'phase')
    throw new Error('Expected a phase prompt.');
  assert.equal(resumed.nextPrompt?.targetVersion, '1.0.2');
  assert.match(
    renderDashboard({
      plan,
      states: new Map(),
      current: undefined,
      activity: '',
      tracker: createEventTracker(),
      startedAt: 0,
    }),
    /Roadmap:\s+Post-1\.0/,
  );
  assert.match(
    renderSuccessHandoff(plan, '.codex-runs/p1-0/test'),
    /POST-1\.0 PHASE 0 IMPLEMENTATION PROMPTS COMPLETE/,
  );

  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [
          { sha: 'one', subject: '1.0.1' },
          { sha: 'two', subject: '1.0.2' },
        ],
        '1.0.0',
      ),
    /expected 1\.0\.2/,
  );
  const duplicateResume = detectCompletedPromptPrefix(
    plan,
    [
      { sha: 'one-newest', subject: '1.0.1' },
      { sha: 'two', subject: '1.0.2' },
      { sha: 'one-older', subject: '1.0.1' },
    ],
    '1.0.2',
  );
  assert.equal(duplicateResume.completedCount, 2);
  assert.equal(duplicateResume.completed[0]?.commitSha, 'one-newest');
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [{ sha: 'two', subject: '1.0.2' }],
        '1.0.0',
      ),
    /P2 is completed while P1 is missing/,
  );
});

test('post-2.0 resume uses the shared roadmap version authority and fails closed', () => {
  const plan = buildPlan(
    [post2Prompt(1), post2Prompt(2), post2Prompt(3, { closeout: true })],
    'p2-1',
  );
  assert.equal(plan.mode, 'phase');
  if (plan.mode !== 'phase') throw new Error('Expected a phase plan.');
  assert.equal(plan.roadmapFamily, 'post-2.0');
  assert.equal(plan.roadmapMajor, 2);
  assert.equal(roadmapFamilyLabel(plan.roadmapFamily), 'Post-2.0');
  assert.equal(roadmapVersionFor(plan, 0), '2.1.0');
  assert.equal(roadmapVersionFor(plan, 1), '2.1.1');

  const initial = detectCompletedPromptPrefix(plan, [], '2.1.0');
  assert.equal(initial.completedCount, 0);
  assert.equal(initial.previousVersion, '2.1.0');

  const resumed = detectCompletedPromptPrefix(
    plan,
    [
      { sha: 'unrelated', subject: 'documentation update' },
      { sha: 'one', subject: '2.1.1' },
    ],
    '2.1.1',
  );
  assert.equal(resumed.completedCount, 1);
  assert.equal(resumed.previousVersion, '2.1.1');
  assert.equal(resumed.nextPrompt?.mode, 'phase');
  if (resumed.nextPrompt?.mode !== 'phase')
    throw new Error('Expected a phase prompt.');
  assert.equal(resumed.nextPrompt.targetVersion, '2.1.2');
  assert.match(
    renderDashboard({
      plan,
      states: new Map(),
      current: undefined,
      activity: '',
      tracker: createEventTracker(),
      startedAt: 0,
    }),
    /Roadmap:\s+Post-2\.0/,
  );
  assert.match(
    renderSuccessHandoff(plan, '.codex-runs/p2-1/test'),
    /POST-2\.0 PHASE 1 IMPLEMENTATION PROMPTS COMPLETE/,
  );

  const threeMarkerResume = detectCompletedPromptPrefix(
    plan,
    [
      { sha: 'one-newest', subject: '2.1.1' },
      { sha: 'one-middle', subject: '2.1.1' },
      { sha: 'one-oldest', subject: '2.1.1' },
    ],
    '2.1.1',
  );
  assert.equal(threeMarkerResume.completedCount, 1);
  assert.equal(threeMarkerResume.completed[0]?.commitSha, 'one-newest');
  assert.equal(threeMarkerResume.nextPrompt?.number, 2);
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [{ sha: 'two', subject: '2.1.2' }],
        '2.1.0',
      ),
    /P2 is completed while P1 is missing/,
  );
  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [{ sha: 'one', subject: '2.1.1' }],
        '2.1.0',
      ),
    /expected 2\.1\.1/,
  );
});

test('correction resume keeps duplicate exact-subject markers fail-closed', () => {
  const plan = buildPlan(
    [correctionPrompt(1), correctionPrompt(2, { closeout: true })],
    'c10-single-publication',
  );
  const subject = promptCommitSubject(plan, plan.implementations[0]!);

  assert.throws(
    () =>
      detectCompletedPromptPrefix(
        plan,
        [
          { sha: 'newest', subject },
          { sha: 'older', subject },
        ],
        '0.10.0',
      ),
    /ambiguous for P1/,
  );
});

test('a synthetic post-2.0 repository resumes P1 by its exact semantic-version subject', async () => {
  const rootDirectory = await createPost2PhaseRepository(1);
  const validator = path.resolve('scripts', 'validate-codex-phase.mjs');
  const output = testOutput(false);
  try {
    const baselinePlan = buildPlan(
      [post2Prompt(1), post2Prompt(2, { closeout: true })],
      'p2-1',
    );
    assert.equal(
      detectCompletedPromptPrefix(baselinePlan, [], '2.1.0').previousVersion,
      '2.1.0',
    );
    const validation = spawnSync(process.execPath, [validator, 'p2-1'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(validation.status, 0, String(validation.stderr));
    assert.match(
      String(validation.stdout),
      /Post-2\.0 Phase 1 prompt grammar: VALID/,
    );

    const firstSha = await commitPost2RoadmapCompletion(rootDirectory, 1);
    await commitUnrelated(rootDirectory, 'documentation-update');
    assert.equal(
      detectCompletedPromptPrefix(
        baselinePlan,
        [
          { sha: 'unrelated', subject: 'documentation-update' },
          { sha: firstSha, subject: '2.1.1' },
        ],
        '2.1.1',
      ).previousVersion,
      '2.1.1',
    );
    assert.equal(
      await runCli(['p2-1'], {
        rootDirectory,
        stdout: output,
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async () => {
          throw new Error(
            'The completed 2.x implementation prefix must resume.',
          );
        },
      }),
      0,
    );
    assert.match(output.read(), /P1 previously completed - commit/);
    assert.equal(
      gitResult(rootDirectory, ['log', '-2', '--format=%s']),
      'documentation-update\n2.1.1',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('roadmap resume skips a proven prefix across unrelated commits and records historical SHAs', async () => {
  const rootDirectory = await createPhaseRepository(3);
  const codexCalls: number[] = [];
  const output = testOutput(false);
  try {
    const firstSha = await commitRoadmapCompletion(rootDirectory, 1);
    await commitUnrelated(rootDirectory, 'documentation-update');
    const secondSha = await commitRoadmapCompletion(rootDirectory, 2);
    await commitUnrelated(rootDirectory, 'runner-maintenance');
    const result = await runCli(['p8'], {
      rootDirectory,
      stdout: output,
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        codexCalls.push(parsedPrompt.number);
        await writeFile(
          path.join(rootDirectory, 'package.json'),
          `${JSON.stringify({ name: 'phase-test', version: '0.8.3' }, null, 2)}\n`,
        );
        await writeFile(path.join(rootDirectory, 'P3-new.txt'), 'new\n');
        return {
          code: 0,
          signal: null,
          finalResponse: 'completed P3',
          stderr: '',
          childArgs: [],
        };
      },
    });
    assert.equal(result, 0);
    assert.deepEqual(codexCalls, [3]);
    const runFolders = await readdir(
      path.join(rootDirectory, '.codex-runs', 'p8'),
    );
    const run = JSON.parse(
      await readFile(
        path.join(
          rootDirectory,
          '.codex-runs',
          'p8',
          runFolders[0]!,
          'run.json',
        ),
        'utf8',
      ),
    );
    assert.deepEqual(
      run.prompts
        .slice(0, 2)
        .map(
          ({ status, commitSha }: { status: string; commitSha: string }) => ({
            status,
            commitSha,
          }),
        ),
      [
        { status: 'previously_completed', commitSha: firstSha },
        { status: 'previously_completed', commitSha: secondSha },
      ],
    );
    assert.match(output.read(), /P1 previously completed - commit/);
    assert.match(output.read(), /Resuming at P3/);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('roadmap resume after P1 starts P2 even when an unrelated commit is newer', async () => {
  const rootDirectory = await createPhaseRepository(2);
  const codexCalls: number[] = [];
  try {
    await commitRoadmapCompletion(rootDirectory, 1);
    await commitUnrelated(rootDirectory, 'runner-update');
    await runCli(['p8'], {
      rootDirectory,
      stdout: testOutput(false),
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        codexCalls.push(parsedPrompt.number);
        await writeFile(
          path.join(rootDirectory, 'package.json'),
          `${JSON.stringify({ version: '0.8.2' })}\n`,
        );
        await writeFile(path.join(rootDirectory, 'P2-new.txt'), 'new\n');
        return {
          code: 0,
          signal: null,
          finalResponse: 'done',
          stderr: '',
          childArgs: [],
        };
      },
    });
    assert.deepEqual(codexCalls, [2]);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('all completed roadmap prompts launch no Codex process and retain manual closeout', async () => {
  const rootDirectory = await createPhaseRepository(2);
  let codexCalls = 0;
  const output = testOutput(false);
  try {
    await commitRoadmapCompletion(rootDirectory, 1);
    await commitRoadmapCompletion(rootDirectory, 2);
    assert.equal(
      await runCli(['p8'], {
        rootDirectory,
        stdout: output,
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async () => {
          codexCalls += 1;
          throw new Error('must not run');
        },
      }),
      0,
    );
    assert.equal(codexCalls, 0);
    assert.match(output.read(), /IMPLEMENTATION PROMPTS COMPLETE/);
    assert.match(output.read(), /Execution:\s+MANUAL/);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('correction resume uses the exact subject and tolerates a newer unrelated commit', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const codexCalls: number[] = [];
  try {
    await writeFile(path.join(rootDirectory, 'correction-1.txt'), 'done\n');
    gitResult(rootDirectory, ['add', '-A']);
    gitResult(rootDirectory, [
      'commit',
      '--quiet',
      '-m',
      'c10-single-publication/P1: Correction 1',
    ]);
    await commitUnrelated(rootDirectory, 'unrelated-correction-docs');
    await runCli(['c10-single-publication'], {
      rootDirectory,
      stdout: testOutput(false),
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        codexCalls.push(parsedPrompt.number);
        await writeFile(path.join(rootDirectory, 'correction-2.txt'), 'done\n');
        return {
          code: 0,
          signal: null,
          finalResponse: 'done',
          stderr: '',
          childArgs: [],
        };
      },
    });
    assert.deepEqual(codexCalls, [2]);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('dirty working tree still prevents resume inspection from launching Codex', async () => {
  const rootDirectory = await createPhaseRepository(2);
  let codexCalls = 0;
  try {
    await commitRoadmapCompletion(rootDirectory, 1);
    await writeFile(path.join(rootDirectory, 'dirty.txt'), 'dirty\n');
    await assert.rejects(
      runCli(['p8'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async () => {
          codexCalls += 1;
          throw new Error('must not run');
        },
      }),
      /uncommitted changes/,
    );
    assert.equal(codexCalls, 0);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('correction loop commits multiple prompts at one unchanged version and leaves closeout manual', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const output = testOutput(false);
  const codexCalls: number[] = [];
  const responses = new Map([
    [1, 'First correction response\nwith `code` and Unicode café.\n'],
    [2, 'Second correction response\n\nExact trailing newline.\n'],
  ]);
  try {
    const result = await runCli(['c10-single-publication'], {
      rootDirectory,
      stdout: output,
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        codexCalls.push(parsedPrompt.number);
        const manifest = JSON.parse(
          await readFile(path.join(rootDirectory, 'package.json'), 'utf8'),
        );
        assert.equal(manifest.version, '0.10.0');
        await writeFile(
          path.join(rootDirectory, `correction-${parsedPrompt.number}.txt`),
          `change ${parsedPrompt.number}\n`,
        );
        return {
          code: 0,
          signal: null,
          finalResponse: responses.get(parsedPrompt.number),
          stderr: '',
          childArgs: [],
        };
      },
    });

    assert.equal(result, 0);
    assert.deepEqual(codexCalls, [1, 2]);
    assert.deepEqual(
      gitResult(rootDirectory, ['log', '-2', '--format=%s']).split('\n'),
      [
        'c10-single-publication/P2: Correction 2',
        'c10-single-publication/P1: Correction 1',
      ],
    );
    assert.equal(
      commitMessage(rootDirectory, 'HEAD~1'),
      `c10-single-publication/P1: Correction 1\n\n${responses.get(1)}`,
    );
    assert.equal(
      commitMessage(rootDirectory, 'HEAD'),
      `c10-single-publication/P2: Correction 2\n\n${responses.get(2)}`,
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(rootDirectory, 'package.json'), 'utf8'),
      ).version,
      '0.10.0',
    );
    assert.equal(gitResult(rootDirectory, ['status', '--porcelain=v1']), '');

    const runFolders = await readdir(
      path.join(rootDirectory, '.codex-runs', 'c10-single-publication'),
    );
    assert.equal(runFolders.length, 1);
    const runDirectory = path.join(
      rootDirectory,
      '.codex-runs',
      'c10-single-publication',
      runFolders[0]!,
    );
    const run = JSON.parse(
      await readFile(path.join(runDirectory, 'run.json'), 'utf8'),
    );
    assert.equal(run.stackMode, 'correction');
    assert.equal(run.phase, 10);
    assert.deepEqual(run.correction, {
      folder: 'c10-single-publication',
      slug: 'single-publication',
    });
    assert.equal(run.unchangedVersion, '0.10.0');
    assert.equal(run.status, 'implementation_complete');
    assert.equal(run.prompts[0].mode, 'correction');
    assert.equal(run.prompts[0].unchangedVersion, '0.10.0');
    assert.match(run.prompts[0].commitSha, /^[0-9a-f]{40,64}$/);
    assert.equal(run.prompts[2].status, 'manual');
    assert.equal(
      await readFile(path.join(runDirectory, 'P1.commit-message.txt'), 'utf8'),
      `c10-single-publication/P1: Correction 1\n\n${responses.get(1)}`,
    );
    assert.match(
      output.read(),
      /Correction stack c10-single-publication started/,
    );
    assert.match(output.read(), /P1 started - 0\.10\.0 \(UNCHANGED\)/);
    assert.match(
      output.read(),
      /CORRECTION STACK c10-single-publication IMPLEMENTATION PROMPTS COMPLETE/,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('correction version mutation fails before commit and blocks every later prompt', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const codexCalls: number[] = [];
  try {
    await assert.rejects(
      runCli(['c10-single-publication'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          await writeFile(
            path.join(rootDirectory, 'package.json'),
            `${JSON.stringify({ version: '0.10.1' })}\n`,
          );
          await writeFile(path.join(rootDirectory, 'change.txt'), 'change\n');
          return {
            code: 0,
            signal: null,
            finalResponse: 'must not commit',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      /Expected unchanged package version 0\.10\.0; found 0\.10\.1/,
    );
    assert.deepEqual(codexCalls, [1]);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'baseline',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('correction run refuses a mismatched starting version before Codex starts', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const codexCalls: number[] = [];
  try {
    await writeFile(
      path.join(rootDirectory, 'package.json'),
      `${JSON.stringify({ version: '0.10.1' })}\n`,
    );
    gitResult(rootDirectory, ['add', 'package.json']);
    gitResult(rootDirectory, [
      'commit',
      '--quiet',
      '-m',
      'wrong version baseline',
    ]);
    await assert.rejects(
      runCli(['c10-single-publication'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          throw new Error('must not start');
        },
      }),
      /expected unchanged package version 0\.10\.0; found 0\.10\.1/,
    );
    assert.deepEqual(codexCalls, []);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('correction post-commit version mismatch fails closed before the next prompt', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const codexCalls: number[] = [];
  let mutatedAfterCommit = false;
  try {
    await assert.rejects(
      runCli(['c10-single-publication'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        spawnSyncProcess: (
          command: string,
          arguments_: string[],
          options: { shell: boolean },
        ) => {
          const result = spawnSync(command, arguments_, {
            ...options,
            cwd: rootDirectory,
            encoding: 'utf8',
          });
          if (
            !mutatedAfterCommit &&
            arguments_[0] === 'cat-file' &&
            arguments_[1] === 'commit'
          ) {
            mutatedAfterCommit = true;
            writeFileSync(
              path.join(rootDirectory, 'package.json'),
              `${JSON.stringify({ version: '0.10.1' })}\n`,
            );
          }
          return result;
        },
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          await writeFile(path.join(rootDirectory, 'change.txt'), 'change\n');
          return {
            code: 0,
            signal: null,
            finalResponse: 'committed response\n',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      /Package version changed during commit verification; expected 0\.10\.0/,
    );
    assert.equal(mutatedAfterCommit, true);
    assert.deepEqual(codexCalls, [1]);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('a failed correction Codex process prevents every later implementation prompt', async () => {
  const rootDirectory = await createCorrectionRepository(2);
  const codexCalls: number[] = [];
  try {
    await assert.rejects(
      runCli(['c10-single-publication'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          return {
            code: 23,
            signal: null,
            finalResponse: '',
            stderr: 'failed',
            childArgs: [],
          };
        },
      }),
      /Codex exited with status 23/,
    );
    assert.deepEqual(codexCalls, [1]);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'baseline',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('empty and interrupted prompt changes fail closed without a commit', async () => {
  const rootDirectory = await createPhaseRepository(1);
  const runDirectory = path.join(rootDirectory, '.codex-runs', 'test');
  await mkdir(runDirectory, { recursive: true });
  const parsed = parsePrompt(prompt(1).filename, prompt(1).text);
  const baseline = gitResult(rootDirectory, ['rev-parse', 'HEAD']);
  try {
    await assert.rejects(
      commitPromptChanges(
        {
          prompt: parsed,
          finalResponse: 'unused',
          runDirectory,
          prePromptHead: baseline,
        },
        { rootDirectory },
      ),
      /commit boundary failed: No implementation changes/,
    );

    await writeFile(
      path.join(rootDirectory, 'package.json'),
      `${JSON.stringify({ name: 'phase-test', version: '0.8.1' }, null, 2)}\n`,
    );
    await assert.rejects(
      commitPromptChanges(
        {
          prompt: parsed,
          finalResponse: 'unused',
          runDirectory,
          prePromptHead: baseline,
        },
        { rootDirectory, isInterrupted: () => true },
      ),
      /commit boundary failed: Phase run was interrupted/,
    );
    assert.equal(gitResult(rootDirectory, ['rev-parse', 'HEAD']), baseline);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('a Codex-created commit is rejected because the runner owns the single commit boundary', async () => {
  const rootDirectory = await createPhaseRepository(1);
  const runDirectory = path.join(rootDirectory, '.codex-runs', 'test');
  await mkdir(runDirectory, { recursive: true });
  const parsed = parsePrompt(prompt(1).filename, prompt(1).text);
  const baseline = gitResult(rootDirectory, ['rev-parse', 'HEAD']);
  try {
    await writeFile(path.join(rootDirectory, 'unauthorized.txt'), 'first\n');
    gitResult(rootDirectory, ['add', '-A']);
    gitResult(rootDirectory, ['commit', '--quiet', '-m', 'unauthorized']);
    await writeFile(path.join(rootDirectory, 'pending.txt'), 'second\n');
    await assert.rejects(
      commitPromptChanges(
        {
          prompt: parsed,
          finalResponse: 'done',
          runDirectory,
          prePromptHead: baseline,
        },
        { rootDirectory },
      ),
      /HEAD changed during implementation; the runner owns/,
    );
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'unauthorized',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('commit failure prevents every later implementation prompt', async () => {
  const rootDirectory = await createPhaseRepository(2);
  const codexCalls: number[] = [];
  try {
    await assert.rejects(
      runCli(['p8'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        spawnSyncProcess: (
          command: string,
          arguments_: string[],
          options: { shell: boolean },
        ) =>
          arguments_[0] === 'commit'
            ? { status: 1, stdout: '', stderr: 'test commit rejection' }
            : spawnSync(command, arguments_, {
                ...options,
                cwd: rootDirectory,
                encoding: 'utf8',
              }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          await writeFile(
            path.join(rootDirectory, 'package.json'),
            `${JSON.stringify({ version: `0.8.${parsedPrompt.number}` })}\n`,
          );
          await writeFile(path.join(rootDirectory, 'change.txt'), 'change\n');
          return {
            code: 0,
            signal: null,
            finalResponse: 'done',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      /implementation completed but its commit boundary failed: Git commit failed/,
    );
    assert.deepEqual(codexCalls, [1]);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'baseline',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('commit verification and dirty-tree failures prevent every later prompt', async () => {
  for (const failure of ['subject', 'dirty'] as const) {
    const rootDirectory = await createPhaseRepository(2);
    const codexCalls: number[] = [];
    let statusCalls = 0;
    try {
      await assert.rejects(
        runCli(['p8'], {
          rootDirectory,
          stdout: testOutput(false),
          resolveLauncher: async () => ({
            launcher: directTestLauncher,
            version: compatibleCodexVersion,
          }),
          spawnSyncProcess: (
            command: string,
            arguments_: string[],
            options: { shell: boolean },
          ) => {
            if (arguments_[0] === 'status') statusCalls += 1;
            if (
              failure === 'subject' &&
              arguments_[0] === 'log' &&
              arguments_.includes('--format=%s')
            ) {
              return { status: 0, stdout: 'wrong-subject\n', stderr: '' };
            }
            if (
              failure === 'dirty' &&
              arguments_[0] === 'status' &&
              statusCalls === 4
            ) {
              return { status: 0, stdout: ' M leftover.txt\n', stderr: '' };
            }
            return spawnSync(command, arguments_, {
              ...options,
              cwd: rootDirectory,
              encoding: 'utf8',
            });
          },
          runCodexProcess: async (parsedPrompt: { number: number }) => {
            codexCalls.push(parsedPrompt.number);
            await writeFile(
              path.join(rootDirectory, 'package.json'),
              `${JSON.stringify({ version: `0.8.${parsedPrompt.number}` })}\n`,
            );
            await writeFile(path.join(rootDirectory, 'change.txt'), 'change\n');
            return {
              code: 0,
              signal: null,
              finalResponse: 'done\n',
              stderr: '',
              childArgs: [],
            };
          },
        }),
        /commit boundary failed/,
      );
      assert.deepEqual(codexCalls, [1]);
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  }
});

test('package-lock creation fails before commit and prevents later prompts', async () => {
  const rootDirectory = await createPhaseRepository(2);
  const codexCalls: number[] = [];
  try {
    await assert.rejects(
      runCli(['p8'], {
        rootDirectory,
        stdout: testOutput(false),
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          codexCalls.push(parsedPrompt.number);
          await writeFile(
            path.join(rootDirectory, 'package.json'),
            `${JSON.stringify({ version: `0.8.${parsedPrompt.number}` })}\n`,
          );
          await writeFile(
            path.join(rootDirectory, 'package-lock.json'),
            '{}\n',
          );
          return {
            code: 0,
            signal: null,
            finalResponse: 'done',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      /package-lock\.json was created/,
    );
    assert.deepEqual(codexCalls, [1]);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'baseline',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('Git process transport is an argument array and remains shell-free', () => {
  let invocation: unknown;
  const result = invokeGit(['commit', '--file', 'message.txt'], {
    rootDirectory: 'C:\\repo',
    spawnSyncProcess: (
      command: string,
      arguments_: string[],
      options: { cwd: string; shell: boolean },
    ) => {
      invocation = { command, arguments: arguments_, options };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(invocation, {
    command: 'git',
    arguments: ['commit', '--file', 'message.txt'],
    options: {
      cwd: 'C:\\repo',
      encoding: 'utf8',
      shell: false,
    },
  });
});

test('successful handoff preserves exit-success manual-closeout semantics', () => {
  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const output = renderSuccessHandoff(plan, '.codex-runs/p8/test');
  assert.match(output, /IMPLEMENTATION PROMPTS COMPLETE/);
  assert.match(output, /Execution:\s+MANUAL/);
  assert.match(output, /Automation stopped by design/);
  assert.doesNotMatch(output, /executing closeout/i);
});

test('auto-run closeout executes after implementation commits and ends terminal output with its full response', async () => {
  const rootDirectory = await createPhaseRepository(1);
  const output = testOutput(false);
  const calls: number[] = [];
  const closeoutResponse = 'Closeout review: human acceptance is required.\n';
  try {
    assert.equal(
      await runCli(['--closeout', 'p8', '--verbose'], {
        rootDirectory,
        stdout: output,
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (
          parsedPrompt: {
            number: number;
            model: string;
            reasoning: string;
            text: string;
          },
          runDirectory: string,
        ) => {
          calls.push(parsedPrompt.number);
          if (parsedPrompt.number === 1) {
            await writeFile(
              path.join(rootDirectory, 'package.json'),
              `${JSON.stringify({ name: 'phase-test', version: '0.8.1' })}\n`,
            );
            await writeFile(
              path.join(rootDirectory, 'implementation.txt'),
              'done\n',
            );
            return {
              code: 0,
              signal: null,
              finalResponse: 'implementation response',
              stderr: '',
              childArgs: [],
            };
          }
          assert.equal(parsedPrompt.model, 'gpt-5.6-terra');
          assert.equal(parsedPrompt.reasoning, 'high');
          assert.match(parsedPrompt.text, /Perform Phase 8 closeout/);
          assert.equal(
            gitResult(rootDirectory, ['log', '-1', '--format=%s']),
            '0.8.1',
          );
          assert.equal(
            gitResult(rootDirectory, ['status', '--porcelain=v1']),
            '',
          );
          await writeFile(
            path.join(rootDirectory, 'closeout-evidence.txt'),
            'review\n',
          );
          await writeFile(
            path.join(runDirectory, 'P2.final.txt'),
            closeoutResponse,
          );
          return {
            code: 0,
            signal: null,
            finalResponse: closeoutResponse,
            stderr: '',
            childArgs: [],
          };
        },
      }),
      0,
    );
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual(
      gitResult(rootDirectory, ['log', '--format=%s']).split('\n').slice(0, 2),
      ['0.8.1', 'baseline'],
    );
    assert.match(
      gitResult(rootDirectory, ['status', '--porcelain=v1']),
      /closeout-evidence/,
    );
    const [runName] = await readdir(
      path.join(rootDirectory, '.codex-runs', 'p8'),
    );
    const runDirectory = path.join(
      rootDirectory,
      '.codex-runs',
      'p8',
      runName!,
    );
    const run = JSON.parse(
      await readFile(path.join(runDirectory, 'run.json'), 'utf8'),
    );
    assert.equal(run.closeoutMode, 'auto');
    assert.equal(run.status, 'closeout_executed_review_required');
    assert.equal(run.prompts[1].status, 'review_required');
    assert.equal(run.prompts[1].finalResponseFile, 'P2.final.txt');
    await assert.rejects(
      access(path.join(runDirectory, 'P2.commit-message.txt')),
    );
    assert.equal(
      await readFile(path.join(runDirectory, 'P2.final.txt'), 'utf8'),
      closeoutResponse,
    );
    assert.ok(output.read().endsWith(closeoutResponse));
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('auto-run closeout resumes directly from an implementation-complete prefix', async () => {
  const rootDirectory = await createPhaseRepository(1);
  const calls: number[] = [];
  try {
    await commitRoadmapCompletion(rootDirectory, 1);
    await runCli(['p8', '--closeout'], {
      rootDirectory,
      stdout: testOutput(false),
      resolveLauncher: async () => ({
        launcher: directTestLauncher,
        version: compatibleCodexVersion,
      }),
      runCodexProcess: async (parsedPrompt: { number: number }) => {
        calls.push(parsedPrompt.number);
        assert.equal(parsedPrompt.number, 2);
        return {
          code: 0,
          signal: null,
          finalResponse: 'read-only review',
          stderr: '',
          childArgs: [],
        };
      },
    });
    assert.deepEqual(calls, [2]);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      '0.8.1',
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('a one-prompt correction closeout runs only with --closeout and remains review required', async () => {
  const rootDirectory = await createCorrectionRepository(0);
  const output = testOutput(false);
  try {
    const baselineHead = gitResult(rootDirectory, ['rev-parse', 'HEAD']);
    const calls: number[] = [];
    assert.equal(
      await runCli(['c10-single-publication', '--closeout'], {
        rootDirectory,
        stdout: output,
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: {
          number: number;
          mode: string;
        }) => {
          calls.push(parsedPrompt.number);
          assert.equal(parsedPrompt.mode, 'correction');
          await writeFile(
            path.join(rootDirectory, 'closeout-evidence.txt'),
            'reviewed\n',
          );
          return {
            code: 0,
            signal: null,
            finalResponse: 'HUMAN REVIEW REQUIRED',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      0,
    );
    assert.deepEqual(calls, [1]);
    assert.equal(gitResult(rootDirectory, ['rev-parse', 'HEAD']), baselineHead);
    assert.equal(
      gitResult(rootDirectory, ['log', '-1', '--format=%s']),
      'baseline',
    );
    assert.equal(
      gitResult(rootDirectory, ['status', '--porcelain=v1']).includes(
        'package-lock.json',
      ),
      false,
    );
    const [runName] = await readdir(
      path.join(rootDirectory, '.codex-runs', 'c10-single-publication'),
    );
    const runDirectory = path.join(
      rootDirectory,
      '.codex-runs',
      'c10-single-publication',
      runName!,
    );
    const run = JSON.parse(
      await readFile(path.join(runDirectory, 'run.json'), 'utf8'),
    );
    assert.equal(run.status, 'closeout_executed_review_required');
    assert.equal(run.prompts[0].status, 'review_required');
    await assert.rejects(
      access(path.join(runDirectory, 'P1.commit-message.txt')),
    );
    assert.ok(output.read().endsWith('HUMAN REVIEW REQUIRED'));
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('auto-run closeout enforces normalized phase and correction version boundaries without committing it', async () => {
  const scenarios = [
    {
      create: createPhaseRepository,
      folder: 'p8',
      implementationVersion: '0.8.1',
      closeoutVersion: '0.8.2',
      allowed: ['0.8.1', '0.8.2'],
    },
    {
      create: createCorrectionRepository,
      folder: 'c10-single-publication',
      implementationVersion: '0.10.0',
      closeoutVersion: '0.10.0',
      allowed: ['0.10.0'],
    },
  ];
  for (const scenario of scenarios) {
    for (const version of scenario.allowed) {
      const rootDirectory = await scenario.create(1);
      try {
        await runCli([scenario.folder, '--closeout'], {
          rootDirectory,
          stdout: testOutput(false),
          resolveLauncher: async () => ({
            launcher: directTestLauncher,
            version: compatibleCodexVersion,
          }),
          runCodexProcess: async (parsedPrompt: { number: number }) => {
            if (parsedPrompt.number === 1) {
              await writeFile(
                path.join(rootDirectory, 'package.json'),
                `${JSON.stringify({ version: scenario.implementationVersion })}\n`,
              );
              await writeFile(
                path.join(rootDirectory, 'implementation.txt'),
                'done\n',
              );
            } else if (version !== scenario.implementationVersion) {
              await writeFile(
                path.join(rootDirectory, 'package.json'),
                `${JSON.stringify({ version })}\n`,
              );
            }
            return {
              code: 0,
              signal: null,
              finalResponse: 'review',
              stderr: '',
              childArgs: [],
            };
          },
        });
        assert.equal(
          gitResult(rootDirectory, ['log', '-1', '--format=%s']),
          scenario.folder === 'p8'
            ? '0.8.1'
            : 'c10-single-publication/P1: Correction 1',
        );
      } finally {
        await rm(rootDirectory, { recursive: true, force: true });
      }
    }
  }
});

test('auto-run closeout rejects HEAD drift, lockfiles, invalid versions, and incoherent diffs', async () => {
  for (const failure of ['head', 'lockfile', 'version', 'diff'] as const) {
    const rootDirectory = await createPhaseRepository(1);
    try {
      await assert.rejects(
        runCli(['p8', '--closeout'], {
          rootDirectory,
          stdout: testOutput(false),
          resolveLauncher: async () => ({
            launcher: directTestLauncher,
            version: compatibleCodexVersion,
          }),
          runCodexProcess: async (parsedPrompt: { number: number }) => {
            if (parsedPrompt.number === 1) {
              await writeFile(
                path.join(rootDirectory, 'package.json'),
                `${JSON.stringify({ version: '0.8.1' })}\n`,
              );
              await writeFile(
                path.join(rootDirectory, 'implementation.txt'),
                'done\n',
              );
            } else if (failure === 'head') {
              await writeFile(
                path.join(rootDirectory, 'self-commit.txt'),
                'bad\n',
              );
              gitResult(rootDirectory, ['add', '-A']);
              gitResult(rootDirectory, [
                'commit',
                '--quiet',
                '-m',
                'self commit',
              ]);
            } else if (failure === 'lockfile') {
              await writeFile(
                path.join(rootDirectory, 'package-lock.json'),
                '{}\n',
              );
            } else if (failure === 'version') {
              await writeFile(
                path.join(rootDirectory, 'package.json'),
                `${JSON.stringify({ version: '9.9.9' })}\n`,
              );
            } else {
              await writeFile(
                path.join(rootDirectory, 'implementation.txt'),
                'one\n<<<<<<<\ntwo\n',
              );
            }
            return {
              code: 0,
              signal: null,
              finalResponse: 'captured review',
              stderr: '',
              childArgs: [],
            };
          },
        }),
        /HEAD changed|package-lock|not allowed|diff --check/,
      );
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  }
});

test('runner-level closeout failure after a captured response stays nonzero and presents that response last', async () => {
  const rootDirectory = await createPhaseRepository(1);
  const output = testOutput(false);
  const response = 'Captured closeout response after a safety failure.\n';
  const priorExitCode = process.exitCode;
  const originalStderrWrite = process.stderr.write;
  let diagnostics = '';
  try {
    await assert.rejects(
      runCli(['p8', '--closeout'], {
        rootDirectory,
        stdout: output,
        resolveLauncher: async () => ({
          launcher: directTestLauncher,
          version: compatibleCodexVersion,
        }),
        runCodexProcess: async (parsedPrompt: { number: number }) => {
          if (parsedPrompt.number === 1) {
            await writeFile(
              path.join(rootDirectory, 'package.json'),
              `${JSON.stringify({ version: '0.8.1' })}\n`,
            );
            await writeFile(
              path.join(rootDirectory, 'implementation.txt'),
              'done\n',
            );
          } else {
            await writeFile(
              path.join(rootDirectory, 'package.json'),
              `${JSON.stringify({ version: '9.9.9' })}\n`,
            );
          }
          return {
            code: 0,
            signal: null,
            finalResponse:
              parsedPrompt.number === 2 ? response : 'implementation',
            stderr: '',
            childArgs: [],
          };
        },
      }),
      /not allowed/,
    );
    process.stderr.write = ((value: string) => {
      diagnostics += value;
      return true;
    }) as typeof process.stderr.write;
    await handleFailure(
      new Error('Closeout package version 9.9.9 is not allowed.'),
    );
    assert.equal(process.exitCode, 1);
    assert.match(diagnostics, /P2 - Phase 8 closeout validation - FAILED/);
    assert.ok(output.read().endsWith(response));
    const [runName] = await readdir(
      path.join(rootDirectory, '.codex-runs', 'p8'),
    );
    const run = JSON.parse(
      await readFile(
        path.join(rootDirectory, '.codex-runs', 'p8', runName!, 'run.json'),
        'utf8',
      ),
    );
    assert.equal(run.status, 'failed');
    assert.equal(run.prompts[1].status, 'failed');
  } finally {
    process.stderr.write = originalStderrWrite;
    process.exitCode = priorExitCode;
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('auto-run rendering and CLI validation distinguish review-required closeout state', async () => {
  const plan = buildPlan([prompt(1), prompt(2, { closeout: true })], 'p8');
  const states = new Map([
    [1, { status: 'passed' }],
    [2, { status: 'review_required', durationMs: 1 }],
  ]);
  const dashboard = renderDashboard({
    plan,
    states,
    current: undefined,
    activity: '',
    tracker: createEventTracker(),
    startedAt: 0,
    closeoutAutoRun: true,
  });
  assert.match(dashboard, /AUTO-RUN \/ HUMAN REVIEW/);
  assert.match(dashboard, /EXECUTED \/ REVIEW REQUIRED/);
  assert.match(
    renderFailureSummary({
      plan,
      states: new Map([[2, { status: 'failed' }]]),
      failedPrompt: plan.closeout,
      reason: 'safety check failed',
    }),
    /P2 - Phase 8 closeout validation - FAILED/,
  );
  assert.equal(
    renderCloseoutFinalResponse('complete response'),
    `\n${'='.repeat(60)}\nCLOSEOUT AGENT FINAL RESPONSE\n${'='.repeat(60)}\ncomplete response`,
  );
  for (const argv of [
    ['p8', '--unknown'],
    ['p8', '--closeout', '--closeout'],
    ['p8', '--verbose', '--verbose'],
    ['--closeout'],
  ]) {
    await assert.rejects(runCli(argv), /Usage: npm run codex:phase/);
  }
  const runnerSource = await readFile(
    path.join(process.cwd(), 'scripts', 'codex-phase.mjs'),
    'utf8',
  );
  assert.doesNotMatch(runnerSource, /p1-\\?<phase>|roadmapVersionFor/);
});
