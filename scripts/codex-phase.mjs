#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  applyEventObservation,
  assertPostPrompt,
  assertVersionCompatible,
  buildPlan,
  createDisplaySession,
  createEventTracker,
  isColorEnabled,
  createStructuredEventProcessor,
  detectCompletedPromptPrefix,
  interpretEvent,
  printableAscii,
  renderCloseoutFinalResponse,
  renderDashboard,
  renderFailureSummary,
  renderSuccessHandoff,
  startElapsedRedraw,
} from './codex-phase-core.mjs';

const root = process.cwd();
let activeChild;
let interrupted = false;
let activeRun;
let saveActiveRun;
let activePlan;
let activeStates = new Map();
let activePrompt;
let stopActiveRedraw;
let activeDisplay;
let activeDashboard;
let activeCloseoutFinalResponse;
let activeCloseoutOutput;
let closeoutFinalResponsePrinted = false;

const exists = async (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const packageVersion = async (rootDirectory = root) =>
  JSON.parse(await readFile(path.join(rootDirectory, 'package.json'), 'utf8'))
    .version;

export function invokeGit(
  arguments_,
  { rootDirectory = root, spawnSyncProcess = spawnSync } = {},
) {
  return spawnSyncProcess('git', arguments_, {
    cwd: rootDirectory,
    encoding: 'utf8',
    shell: false,
  });
}

function successfulGit(result, action, { trim = true } = {}) {
  if (result.error) throw new Error(`${action}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr ?? result.stdout ?? '').trim();
    throw new Error(
      `${action}${detail ? `: ${detail}` : ` (status ${result.status})`}`,
    );
  }
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}
const withoutPromptText = (prompt) => {
  const copy = { ...prompt };
  delete copy.text;
  return copy;
};

const WINDOWS_NPM_ENTRYPOINT = 'node_modules/@openai/codex/bin/codex.js';
export const MINIMUM_GPT_5_6_CODEX_VERSION = Object.freeze([0, 144, 0]);

export function parseCodexCliVersion(versionOutput) {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?=\s|$)/.exec(
    String(versionOutput),
  );
  return match
    ? Object.freeze(match.slice(1).map((part) => Number(part)))
    : undefined;
}

export function compareNumericVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function formatNumericVersion(version) {
  return version.join('.');
}

export function assertCodexVersionCompatible(
  plan,
  versionOutput,
  { includeCloseout = false } = {},
) {
  if (
    !(includeCloseout ? plan.prompts : plan.implementations).some((prompt) =>
      prompt.model.startsWith('gpt-5.6-'),
    )
  )
    return;
  const observed = parseCodexCliVersion(versionOutput);
  const minimum = formatNumericVersion(MINIMUM_GPT_5_6_CODEX_VERSION);
  if (!observed) {
    throw new Error(
      `Cannot verify GPT-5.6 compatibility from Codex CLI version output ${JSON.stringify(String(versionOutput))}; require Codex CLI >= ${minimum}.`,
    );
  }
  if (compareNumericVersions(observed, MINIMUM_GPT_5_6_CODEX_VERSION) < 0) {
    throw new Error(
      `Codex CLI ${formatNumericVersion(observed)} is incompatible with GPT-5.6 tasks; require Codex CLI >= ${minimum}.`,
    );
  }
}

function codexLauncher(command, prefixArguments, type, identity) {
  return Object.freeze({
    command,
    prefixArguments: Object.freeze([...prefixArguments]),
    type,
    identity,
  });
}

function launcherArguments(launcher, arguments_) {
  return [...launcher.prefixArguments, ...arguments_];
}

function invocationFailure(launcher, result) {
  if (result.error) return result.error.message;
  const detail = String(result.stderr ?? '').trim();
  return detail || `exited with status ${result.status}`;
}

export function checkCodexLauncher(
  launcher,
  { spawnSyncProcess = spawnSync, rootDirectory = root } = {},
) {
  const result = spawnSyncProcess(
    launcher.command,
    launcherArguments(launcher, ['--version']),
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      shell: false,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Codex launcher ${launcher.identity} cannot be invoked: ${invocationFailure(launcher, result)}`,
    );
  }
  const version = String(result.stdout ?? '').trim();
  if (!version) {
    throw new Error(
      `Codex launcher ${launcher.identity} returned no version output.`,
    );
  }
  return version;
}

function windowsCommandPaths(spawnSyncProcess) {
  const result = spawnSyncProcess('where.exe', ['codex'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => path.win32.isAbsolute(entry));
}

async function npmEntrypointForRoot(
  shimRoot,
  shimPaths,
  { fileExists, readTextFile },
) {
  const entrypoint = path.win32.join(
    shimRoot,
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  const normalizedReference = WINDOWS_NPM_ENTRYPOINT.toLowerCase();
  let referencesEntrypoint = false;
  for (const shimPath of shimPaths) {
    try {
      const content = (await readTextFile(shimPath))
        .replaceAll('\\', '/')
        .toLowerCase();
      referencesEntrypoint ||= content.includes(normalizedReference);
    } catch {
      // A second shim variant may still provide readable association evidence.
    }
  }
  if (!referencesEntrypoint) {
    throw new Error(
      `npm Codex shims under ${shimRoot} do not identify the @openai/codex entrypoint.`,
    );
  }
  if (!(await fileExists(entrypoint))) {
    throw new Error(`npm Codex entrypoint does not exist: ${entrypoint}`);
  }

  const packageFile = path.win32.resolve(
    path.win32.dirname(entrypoint),
    '..',
    'package.json',
  );
  let manifest;
  try {
    manifest = JSON.parse(await readTextFile(packageFile));
  } catch (error) {
    throw new Error(
      `npm Codex package metadata is unusable at ${packageFile}: ${error.message}`,
      { cause: error },
    );
  }
  if (
    manifest.name !== '@openai/codex' ||
    manifest.bin?.codex?.replaceAll('\\', '/') !== 'bin/codex.js'
  ) {
    throw new Error(
      `npm Codex package metadata does not unambiguously map codex to bin/codex.js: ${packageFile}`,
    );
  }
  return entrypoint;
}

export async function resolveCodexLauncher({
  platform = process.platform,
  nodeExecutable = process.execPath,
  spawnSyncProcess = spawnSync,
  findWindowsCommands = () => windowsCommandPaths(spawnSyncProcess),
  fileExists = exists,
  readTextFile = (file) => readFile(file, 'utf8'),
  checkLauncher = (launcher) =>
    checkCodexLauncher(launcher, { spawnSyncProcess }),
} = {}) {
  if (platform !== 'win32') {
    const launcher = codexLauncher('codex', [], 'unix-path', 'codex via PATH');
    return Object.freeze({ launcher, version: checkLauncher(launcher) });
  }

  const commandPaths = [...new Set(findWindowsCommands())];
  const failures = [];
  for (const executable of commandPaths.filter(
    (candidate) => path.win32.basename(candidate).toLowerCase() === 'codex.exe',
  )) {
    const launcher = codexLauncher(
      executable,
      [],
      'windows-native',
      `native executable ${executable}`,
    );
    try {
      return Object.freeze({ launcher, version: checkLauncher(launcher) });
    } catch (error) {
      failures.push(error.message);
    }
  }

  const shimPaths = commandPaths.filter((candidate) =>
    ['codex.cmd', 'codex.ps1'].includes(
      path.win32.basename(candidate).toLowerCase(),
    ),
  );
  const roots = new Map();
  for (const shimPath of shimPaths) {
    const shimRoot = path.win32.dirname(shimPath);
    const key = shimRoot.toLowerCase();
    const group = roots.get(key) ?? { shimRoot, shimPaths: [] };
    group.shimPaths.push(shimPath);
    roots.set(key, group);
  }
  if (roots.size > 1) {
    throw new Error(
      `Codex CLI cannot be resolved unambiguously: npm shims were found in ${[...roots.values()].map(({ shimRoot }) => shimRoot).join(', ')}.`,
    );
  }
  if (roots.size === 1) {
    const [{ shimRoot, shimPaths: rootShimPaths }] = [...roots.values()];
    try {
      const entrypoint = await npmEntrypointForRoot(shimRoot, rootShimPaths, {
        fileExists,
        readTextFile,
      });
      const launcher = codexLauncher(
        nodeExecutable,
        [entrypoint],
        'windows-npm',
        `npm @openai/codex entrypoint ${entrypoint}`,
      );
      return Object.freeze({ launcher, version: checkLauncher(launcher) });
    } catch (error) {
      failures.push(error.message);
    }
  }

  const detail = failures.length > 0 ? ` ${failures.join(' ')}` : '';
  throw new Error(
    `Codex CLI cannot be resolved on Windows. Install @openai/codex or make an invocable codex.exe available on PATH.${detail}`,
  );
}

export function buildCodexArguments(prompt, rootDirectory, finalFile) {
  return [
    'exec',
    '--json',
    '--model',
    prompt.model,
    '-c',
    `model_reasoning_effort="${prompt.reasoning}"`,
    '--output-last-message',
    finalFile,
    '-C',
    rootDirectory,
    '-',
  ];
}

const PHASE_RUNNER_EXECUTION_CONTRACT = `PHASE RUNNER EXECUTION CONTRACT

You are being executed by the VidGen phase runner.

Do not create Git commits.

Do not run git commit, git commit --amend, git reset, git rebase,
git merge, git checkout, git switch, or otherwise move or rewrite HEAD.

Read-only Git inspection commands are allowed.

Make the requested implementation changes and run the requested
validation, but leave all implementation changes uncommitted in the
working tree.

The phase runner exclusively owns:
- staging;
- the implementation commit;
- the commit subject;
- the commit body;
- verification of the resulting commit.

If the task asks you to report a commit or tree identity, do not create
a commit yourself. Report the pre-task HEAD and implementation result.
The runner will create the authoritative implementation commit after
your turn completes.

The task instructions remain authoritative except where they conflict
with this runner-owned Git commit boundary.`;

export function buildCodexExecutionPrompt(taskText) {
  return `${PHASE_RUNNER_EXECUTION_CONTRACT}\n\n${taskText}`;
}

export async function runCodex(
  prompt,
  runDirectory,
  onEvent,
  {
    launcher,
    rootDirectory = root,
    spawnProcess = spawn,
    verbose = false,
  } = {},
) {
  if (!launcher) throw new Error('A resolved Codex launcher is required.');
  const eventsFile = path.join(runDirectory, `P${prompt.number}.events.jsonl`);
  const finalFile = path.join(runDirectory, `P${prompt.number}.final.txt`);
  await Promise.all([writeFile(eventsFile, ''), writeFile(finalFile, '')]);
  const childArgs = buildCodexArguments(prompt, rootDirectory, finalFile);
  const child = spawnProcess(
    launcher.command,
    launcherArguments(launcher, childArgs),
    {
      cwd: rootDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    },
  );
  activeChild = child;

  const processor = createStructuredEventProcessor({
    appendLine: (line) => appendFile(eventsFile, line),
    onEvent,
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => processor.push(chunk));
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (verbose) process.stderr.write(chunk);
  });

  child.stdin.end(buildCodexExecutionPrompt(prompt.text));
  let processFailure;
  const result = await new Promise((resolve) => {
    child.once('error', (error) => {
      processFailure = error;
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  let eventFailure;
  try {
    await processor.finish();
  } catch (error) {
    eventFailure = error;
  } finally {
    activeChild = undefined;
  }
  if (eventFailure) throw eventFailure;
  if (processFailure) throw processFailure;

  const finalResponse = await readFile(finalFile, 'utf8');
  return { ...result, finalResponse, stderr, childArgs };
}

export async function commitPromptChanges(
  { plan, prompt, finalResponse, runDirectory, prePromptHead },
  {
    rootDirectory = root,
    spawnSyncProcess = spawnSync,
    isInterrupted = () => false,
  } = {},
) {
  const runGit = (arguments_) =>
    invokeGit(arguments_, { rootDirectory, spawnSyncProcess });
  const interruptionMessage =
    plan?.mode === 'correction'
      ? 'Correction stack run was interrupted.'
      : 'Phase run was interrupted.';
  const assertNotInterrupted = () => {
    if (isInterrupted()) throw new Error(interruptionMessage);
  };
  const boundaryFailure = (error) => {
    throw new Error(
      `P${prompt.number} implementation completed but its commit boundary failed: ${error.message}`,
      { cause: error },
    );
  };

  try {
    if (prompt.mode === 'correction' && plan?.mode !== 'correction') {
      throw new Error(
        'A correction prompt commit requires its normalized correction plan.',
      );
    }
    assertNotInterrupted();
    const currentHead = successfulGit(
      runGit(['rev-parse', 'HEAD']),
      'Unable to inspect HEAD before staging',
    );
    if (currentHead !== prePromptHead) {
      throw new Error(
        'HEAD changed during implementation; the runner owns the prompt commit boundary.',
      );
    }
    const pending = successfulGit(
      runGit(['status', '--porcelain=v1', '--untracked-files=all']),
      'Unable to inspect implementation changes',
    );
    if (!pending) throw new Error('No implementation changes exist to commit.');

    const messageFile = path.join(
      runDirectory,
      `P${prompt.number}.commit-message.txt`,
    );
    const expectedSubject =
      prompt.mode === 'correction'
        ? `${plan.folderName}/P${prompt.number}: ${prompt.title}`
        : prompt.targetVersion;
    const expectedVersion =
      prompt.mode === 'correction'
        ? prompt.unchangedVersion
        : prompt.targetVersion;
    const expectedMessage = `${expectedSubject}\n\n${finalResponse}`;
    await writeFile(messageFile, expectedMessage, 'utf8');

    assertNotInterrupted();
    successfulGit(runGit(['add', '-A']), 'Git staging failed');
    if (await exists(path.join(rootDirectory, 'package-lock.json'))) {
      throw new Error('package-lock.json was created.');
    }
    const staged = runGit(['diff', '--cached', '--quiet', '--']);
    if (staged.error)
      throw new Error(
        `Unable to inspect staged changes: ${staged.error.message}`,
      );
    if (staged.status === 0)
      throw new Error('Staged implementation changes are empty.');
    if (staged.status !== 1) {
      throw new Error(
        `Unable to inspect staged changes${staged.stderr ? `: ${String(staged.stderr).trim()}` : ''}`,
      );
    }
    const stagedStatus = successfulGit(
      runGit(['status', '--porcelain=v1', '--untracked-files=all']),
      'Unable to inspect staged repository state',
    );
    if (!stagedStatus)
      throw new Error('Staged implementation changes are empty.');
    if (
      stagedStatus
        .split(/\r?\n/)
        .some((entry) => entry.length < 2 || entry[1] !== ' ')
    ) {
      throw new Error(
        'Repository state contains unstaged or conflicted changes after staging.',
      );
    }

    assertNotInterrupted();
    successfulGit(
      runGit([
        'commit',
        '--no-gpg-sign',
        '--cleanup=verbatim',
        '--file',
        messageFile,
      ]),
      'Git commit failed',
    );
    assertNotInterrupted();

    const commitSha = successfulGit(
      runGit(['rev-parse', 'HEAD']),
      'Unable to read committed HEAD',
    );
    if (commitSha === prePromptHead) {
      throw new Error('HEAD did not change after Git commit.');
    }
    const committedParent = successfulGit(
      runGit(['rev-parse', 'HEAD^']),
      'Unable to verify committed parent',
    );
    if (committedParent !== prePromptHead) {
      throw new Error(
        'Prompt commit is not the single direct successor of its pre-prompt HEAD.',
      );
    }
    const subject = successfulGit(
      runGit(['log', '-1', '--format=%s']),
      'Unable to verify commit subject',
    );
    if (subject !== expectedSubject) {
      throw new Error(
        `Commit subject ${JSON.stringify(subject)} does not equal ${expectedSubject}.`,
      );
    }
    const commitObject = successfulGit(
      runGit(['cat-file', 'commit', commitSha]),
      'Unable to verify commit message',
      { trim: false },
    );
    const messageBoundary = commitObject.indexOf('\n\n');
    const actualMessage =
      messageBoundary === -1 ? '' : commitObject.slice(messageBoundary + 2);
    if (actualMessage !== expectedMessage) {
      throw new Error(
        'Commit body does not preserve the captured final response.',
      );
    }
    if ((await packageVersion(rootDirectory)) !== expectedVersion) {
      throw new Error(
        `Package version changed during commit verification; expected ${expectedVersion}.`,
      );
    }
    if (await exists(path.join(rootDirectory, 'package-lock.json'))) {
      throw new Error('package-lock.json exists after commit.');
    }
    const remaining = successfulGit(
      runGit(['status', '--porcelain=v1', '--untracked-files=all']),
      'Unable to verify clean working tree',
    );
    if (remaining)
      throw new Error('Working tree is dirty after the prompt commit.');
    assertNotInterrupted();
    return Object.freeze({ commitSha, subject, messageFile });
  } catch (error) {
    boundaryFailure(error);
  }
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const rootDirectory = dependencies.rootDirectory ?? root;
  const stdout = dependencies.stdout ?? process.stdout;
  const resolveLauncher =
    dependencies.resolveLauncher ?? (() => resolveCodexLauncher());
  const runCodexProcess = dependencies.runCodexProcess ?? runCodex;
  const spawnSyncProcess = dependencies.spawnSyncProcess ?? spawnSync;
  const runGit = (arguments_) =>
    invokeGit(arguments_, { rootDirectory, spawnSyncProcess });
  interrupted = false;
  activeCloseoutFinalResponse = undefined;
  activeCloseoutOutput = undefined;
  closeoutFinalResponsePrinted = false;
  let verbose = false;
  let closeoutAutoRun = false;
  const positional = [];
  for (const argument of argv) {
    if (argument === '--verbose') {
      if (verbose)
        throw new Error(
          'Usage: npm run codex:phase -- <task-folder> [--verbose] [--closeout]',
        );
      verbose = true;
    } else if (argument === '--closeout') {
      if (closeoutAutoRun)
        throw new Error(
          'Usage: npm run codex:phase -- <task-folder> [--verbose] [--closeout]',
        );
      closeoutAutoRun = true;
    } else if (argument.startsWith('-')) {
      throw new Error(
        'Usage: npm run codex:phase -- <task-folder> [--verbose] [--closeout]',
      );
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      'Usage: npm run codex:phase -- <task-folder> [--verbose] [--closeout]',
    );
  }

  const folderName = positional[0];
  const taskDirectory = path.join(rootDirectory, 'docs', 'tasks', folderName);
  if (!(await exists(taskDirectory)))
    throw new Error(`Task folder does not exist: docs/tasks/${folderName}`);
  const names = await readdir(taskDirectory);
  const textFiles = names.filter((name) => name.toLowerCase().endsWith('.txt'));
  const entries = await Promise.all(
    textFiles.map(async (filename) => ({
      filename,
      text: await readFile(path.join(taskDirectory, filename), 'utf8'),
    })),
  );
  const plan = buildPlan(entries, folderName);
  const interruptionMessage =
    plan.mode === 'correction'
      ? 'Correction stack run was interrupted.'
      : 'Phase run was interrupted.';
  const states = new Map();
  activePlan = plan;
  activeStates = states;

  if (!(await exists(path.join(rootDirectory, 'package.json'))))
    throw new Error('package.json does not exist.');
  if (await exists(path.join(rootDirectory, 'package-lock.json')))
    throw new Error('package-lock.json exists before the run.');
  const initialStatus = runGit(['status', '--porcelain=v1']);
  if (initialStatus.status !== 0)
    throw new Error(
      `Unable to inspect repository state: ${initialStatus.stderr.trim()}`,
    );
  if (initialStatus.stdout.trim())
    throw new Error(
      'Repository has uncommitted changes; start from an intentional clean phase baseline.',
    );
  const historyOutput = successfulGit(
    runGit(['log', '--format=%H%x09%s', 'HEAD']),
    'Unable to inspect reachable Git history',
  );
  const history = historyOutput
    ? historyOutput.split(/\r?\n/).map((line) => {
        const separator = line.indexOf('\t');
        if (separator === -1)
          throw new Error('Unable to parse reachable Git history.');
        return {
          sha: line.slice(0, separator),
          subject: line.slice(separator + 1),
        };
      })
    : [];
  const resume = detectCompletedPromptPrefix(
    plan,
    history,
    await packageVersion(rootDirectory),
  );
  const { launcher, version: codexVersion } = await resolveLauncher();
  assertCodexVersionCompatible(plan, codexVersion, {
    includeCloseout: closeoutAutoRun,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDirectory = path.join(
    rootDirectory,
    '.codex-runs',
    folderName,
    stamp,
  );
  await mkdir(runDirectory, { recursive: true });
  const run = {
    stackMode: plan.mode,
    phase: plan.phase,
    taskFolder: folderName,
    ...(plan.mode === 'correction'
      ? {
          correction: {
            folder: plan.folderName,
            slug: plan.correctionSlug,
          },
          unchangedVersion: plan.unchangedVersion,
        }
      : {}),
    startedAt: new Date().toISOString(),
    codexVersion,
    closeoutMode: closeoutAutoRun ? 'auto' : 'manual',
    status: 'running',
    prompts: plan.prompts.map((prompt) => ({
      ...withoutPromptText(prompt),
      status:
        prompt.kind === 'closeout'
          ? closeoutAutoRun
            ? 'waiting'
            : 'manual'
          : 'waiting',
    })),
  };
  for (const completed of resume.completed) {
    const record = run.prompts.find(
      (item) => item.number === completed.prompt.number,
    );
    record.status = 'previously_completed';
    record.commitSha = completed.commitSha;
    states.set(completed.prompt.number, {
      status: 'previously_completed',
      commitSha: completed.commitSha,
    });
  }
  if (closeoutAutoRun) {
    states.set(plan.closeout.number, { status: 'waiting' });
  }
  const saveRun = () =>
    writeFile(
      path.join(runDirectory, 'run.json'),
      `${JSON.stringify(run, null, 2)}\n`,
    );
  activeRun = run;
  saveActiveRun = saveRun;
  await saveRun();

  const display = createDisplaySession({
    stream: stdout,
    interactive: Boolean(stdout.isTTY),
    verbose,
    colorEnabled: isColorEnabled({ interactive: stdout.isTTY, verbose }),
  });
  activeDisplay = display;
  display.progress(
    `[.] ${plan.mode === 'correction' ? `Correction stack ${plan.folderName}` : `Phase ${plan.phase}`} started - ${plan.implementations.length} implementation prompts`,
  );
  for (const completed of resume.completed) {
    display.progress(
      `[+] P${completed.prompt.number} previously completed - commit ${completed.commitSha.slice(0, 7)}`,
    );
  }
  if (resume.nextPrompt) {
    display.progress(`[>] Resuming at P${resume.nextPrompt.number}`);
  }

  let previousVersion = resume.previousVersion;
  for (const prompt of plan.implementations.slice(resume.completedCount)) {
    if (interrupted) throw new Error(interruptionMessage);
    activePrompt = prompt;
    assertVersionCompatible(
      await packageVersion(rootDirectory),
      prompt,
      previousVersion,
    );
    const prePromptHead = successfulGit(
      runGit(['rev-parse', 'HEAD']),
      `Unable to read HEAD before P${prompt.number}`,
    );
    const state = { status: 'running' };
    states.set(prompt.number, state);
    const record = run.prompts.find((item) => item.number === prompt.number);
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    const startedAt = Date.now();
    const tracker = createEventTracker();
    let latest = '[.] Waiting for Codex response';
    const dashboard = () =>
      renderDashboard({
        plan,
        states,
        current: prompt,
        activity: latest,
        tracker,
        startedAt,
        terminalWidth: stdout.columns,
        colorEnabled: isColorEnabled({ interactive: stdout.isTTY, verbose }),
        closeoutAutoRun,
      });
    const redraw = () => display.render(dashboard());
    activeDashboard = dashboard;
    display.progress(
      `[>] P${prompt.number} started - ${prompt.mode === 'correction' ? `${prompt.unchangedVersion} (UNCHANGED)` : prompt.targetVersion}`,
    );
    redraw();
    if (display.interactive) {
      stopActiveRedraw = startElapsedRedraw(redraw);
    }

    let result;
    try {
      result = await runCodexProcess(
        prompt,
        runDirectory,
        (event) => {
          const observation = interpretEvent(event, verbose);
          applyEventObservation(tracker, observation);
          if (observation.usage) {
            record.usage = observation.usage;
            state.usage = observation.usage;
          }
          if (observation.visible && observation.activity) {
            latest = printableAscii(observation.activity);
            if (verbose) display.verbose(latest);
            else redraw();
          } else if (observation.agentMessage?.trim()) {
            redraw();
          }
        },
        { launcher, verbose, rootDirectory },
      );
    } finally {
      stopActiveRedraw?.();
      stopActiveRedraw = undefined;
    }
    if (interrupted || result.signal) throw new Error(interruptionMessage);
    record.finalResponseFile = `P${prompt.number}.final.txt`;
    const conflicts = runGit(['diff', '--check']);
    assertPostPrompt({
      exitCode: result.code,
      version: await packageVersion(rootDirectory),
      prompt,
      packageLockExists: await exists(
        path.join(rootDirectory, 'package-lock.json'),
      ),
      coherent: conflicts.status === 0,
    });
    if (interrupted) throw new Error(interruptionMessage);
    const commit = await commitPromptChanges(
      {
        plan,
        prompt,
        finalResponse: result.finalResponse,
        runDirectory,
        prePromptHead,
      },
      {
        rootDirectory,
        spawnSyncProcess,
        isInterrupted: () => interrupted,
      },
    );
    const durationMs = Date.now() - startedAt;
    record.status = 'passed';
    record.endedAt = new Date().toISOString();
    record.durationMs = durationMs;
    record.commitSha = commit.commitSha;
    states.set(prompt.number, {
      status: 'passed',
      durationMs,
      commitSha: commit.commitSha,
      ...(record.usage ? { usage: record.usage } : {}),
    });
    display.progress(
      `[+] P${prompt.number} passed - commit ${commit.commitSha.slice(0, 7)}`,
    );
    activePrompt = undefined;
    activeDashboard = undefined;
    previousVersion =
      prompt.mode === 'phase' ? prompt.targetVersion : prompt.unchangedVersion;
    await saveRun();
  }
  if (closeoutAutoRun) {
    const closeout = plan.closeout;
    const preCloseoutStatus = successfulGit(
      runGit(['status', '--porcelain=v1']),
      'Unable to inspect repository state before closeout',
    );
    if (preCloseoutStatus)
      throw new Error('Repository has uncommitted changes before closeout.');
    if (await exists(path.join(rootDirectory, 'package-lock.json')))
      throw new Error('package-lock.json exists before closeout.');
    const preCloseoutHead = successfulGit(
      runGit(['rev-parse', 'HEAD']),
      'Unable to read HEAD before closeout',
    );
    const preCloseoutVersion = await packageVersion(rootDirectory);
    activePrompt = closeout;
    const state = { status: 'running' };
    states.set(closeout.number, state);
    const record = run.prompts.find((item) => item.number === closeout.number);
    record.status = 'running';
    record.startedAt = new Date().toISOString();
    const startedAt = Date.now();
    const tracker = createEventTracker();
    let latest = '[.] Waiting for Codex response';
    const dashboard = () =>
      renderDashboard({
        plan,
        states,
        current: closeout,
        activity: latest,
        tracker,
        startedAt,
        terminalWidth: stdout.columns,
        colorEnabled: isColorEnabled({ interactive: stdout.isTTY, verbose }),
        closeoutAutoRun,
      });
    const redraw = () => display.render(dashboard());
    activeDashboard = dashboard;
    display.progress(
      `[>] P${closeout.number} closeout started - human review required`,
    );
    redraw();
    if (display.interactive) stopActiveRedraw = startElapsedRedraw(redraw);

    let result;
    try {
      result = await runCodexProcess(
        closeout,
        runDirectory,
        (event) => {
          const observation = interpretEvent(event, verbose);
          applyEventObservation(tracker, observation);
          if (observation.usage) {
            record.usage = observation.usage;
            state.usage = observation.usage;
          }
          if (observation.visible && observation.activity) {
            latest = printableAscii(observation.activity);
            if (verbose) display.verbose(latest);
            else redraw();
          } else if (observation.agentMessage?.trim()) {
            redraw();
          }
        },
        { launcher, verbose, rootDirectory },
      );
    } finally {
      stopActiveRedraw?.();
      stopActiveRedraw = undefined;
    }
    record.finalResponseFile = `P${closeout.number}.final.txt`;
    activeCloseoutFinalResponse = result.finalResponse;
    activeCloseoutOutput = stdout;
    if (interrupted || result.signal) throw new Error(interruptionMessage);
    if (result.code !== 0)
      throw new Error(`Codex exited with status ${result.code}.`);
    const postCloseoutHead = successfulGit(
      runGit(['rev-parse', 'HEAD']),
      'Unable to inspect HEAD after closeout',
    );
    if (postCloseoutHead !== preCloseoutHead) {
      throw new Error(
        'HEAD changed during closeout; closeout changes require human review and must not self-commit.',
      );
    }
    if (await exists(path.join(rootDirectory, 'package-lock.json')))
      throw new Error('package-lock.json was created.');
    const conflicts = runGit(['diff', '--check']);
    if (conflicts.status !== 0)
      throw new Error('Closeout changes fail git diff --check.');
    const postCloseoutVersion = await packageVersion(rootDirectory);
    const allowedVersions =
      plan.mode === 'correction'
        ? [plan.unchangedVersion]
        : [preCloseoutVersion, closeout.targetVersion];
    if (!allowedVersions.includes(postCloseoutVersion)) {
      throw new Error(
        `Closeout package version ${postCloseoutVersion} is not allowed; expected ${allowedVersions.join(' or ')}.`,
      );
    }
    const durationMs = Date.now() - startedAt;
    record.status = 'review_required';
    record.endedAt = new Date().toISOString();
    record.durationMs = durationMs;
    states.set(closeout.number, {
      status: 'review_required',
      durationMs,
      ...(record.usage ? { usage: record.usage } : {}),
    });
    run.status = 'closeout_executed_review_required';
    run.endedAt = record.endedAt;
    await saveRun();
    activePrompt = undefined;
    activeDashboard = undefined;
    const finalDashboard = renderDashboard({
      plan,
      states,
      current: undefined,
      activity: '',
      tracker: createEventTracker(),
      startedAt: Date.now(),
      terminalWidth: stdout.columns,
      colorEnabled: isColorEnabled({ interactive: stdout.isTTY, verbose }),
      closeoutAutoRun,
    });
    display.finalize(finalDashboard);
    activeDisplay = undefined;
    activeRun = undefined;
    saveActiveRun = undefined;
    stdout.write(renderCloseoutFinalResponse(result.finalResponse));
    closeoutFinalResponsePrinted = true;
    return 0;
  }
  run.status = 'implementation_complete';
  run.endedAt = new Date().toISOString();
  await saveRun();
  activeRun = undefined;
  saveActiveRun = undefined;
  const finalDashboard = renderDashboard({
    plan,
    states,
    current: undefined,
    activity: '',
    tracker: createEventTracker(),
    startedAt: Date.now(),
    terminalWidth: stdout.columns,
    colorEnabled: isColorEnabled({ interactive: stdout.isTTY, verbose }),
    closeoutAutoRun,
  });
  display.finalize(finalDashboard);
  stdout.write(
    renderSuccessHandoff(plan, path.relative(rootDirectory, runDirectory)),
  );
  activeDisplay = undefined;
  return 0;
}

export async function handleFailure(error) {
  stopActiveRedraw?.();
  stopActiveRedraw = undefined;
  if (activePrompt) {
    activeStates.set(activePrompt.number, {
      status: interrupted ? 'interrupted' : 'failed',
    });
  }
  activeDisplay?.finalize(activeDashboard?.());
  activeDisplay = undefined;
  activeDashboard = undefined;
  if (activeRun && saveActiveRun) {
    activeRun.status = interrupted ? 'interrupted' : 'failed';
    activeRun.endedAt = new Date().toISOString();
    activeRun.error = error.message;
    const running = activeRun.prompts.find(
      (prompt) => prompt.status === 'running',
    );
    if (running) {
      running.status = interrupted ? 'interrupted' : 'failed';
      running.endedAt = activeRun.endedAt;
    }
    try {
      await saveActiveRun();
    } catch (logError) {
      process.stderr.write(
        `${printableAscii(`Unable to finalize run log: ${logError.message}`)}\n`,
      );
    }
  }
  process.stderr.write(
    renderFailureSummary({
      plan: activePlan,
      states: activeStates,
      failedPrompt: activePrompt,
      reason: error.message,
    }),
  );
  if (
    activeCloseoutFinalResponse !== undefined &&
    activeCloseoutOutput &&
    !closeoutFinalResponsePrinted
  ) {
    activeCloseoutOutput.write(
      renderCloseoutFinalResponse(activeCloseoutFinalResponse),
    );
    closeoutFinalResponsePrinted = true;
  }
  process.exitCode = 1;
}

function interrupt() {
  interrupted = true;
  stopActiveRedraw?.();
  stopActiveRedraw = undefined;
  if (activeChild) activeChild.kill('SIGINT');
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.on('SIGINT', interrupt);
  runCli().catch(handleFailure);
}
