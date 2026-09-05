import { clearScreenDown, cursorTo, moveCursor } from 'node:readline';

export const MODEL_CONFIGS = Object.freeze({
  'Luna Medium': Object.freeze({ model: 'gpt-5.6-luna', reasoning: 'medium' }),
  'Luna High': Object.freeze({ model: 'gpt-5.6-luna', reasoning: 'high' }),
  'Terra Medium': Object.freeze({
    model: 'gpt-5.6-terra',
    reasoning: 'medium',
  }),
  'Terra High': Object.freeze({ model: 'gpt-5.6-terra', reasoning: 'high' }),
  'Terra Ultra': Object.freeze({ model: 'gpt-5.6-terra', reasoning: 'ultra' }),
  'Sol Light': Object.freeze({ model: 'gpt-5.6-sol', reasoning: 'low' }),
  'Sol Medium': Object.freeze({ model: 'gpt-5.6-sol', reasoning: 'medium' }),
  'Sol High': Object.freeze({ model: 'gpt-5.6-sol', reasoning: 'high' }),
  'Sol Ultra': Object.freeze({ model: 'gpt-5.6-sol', reasoning: 'ultra' }),
});

const VALID_CONCRETE_CONFIGS = Object.freeze({
  'gpt-5.6-luna': Object.freeze(new Set(['low', 'medium', 'high'])),
  'gpt-5.6-terra': Object.freeze(new Set(['medium', 'high', 'ultra'])),
  'gpt-5.6-sol': Object.freeze(new Set(['low', 'medium', 'high', 'ultra'])),
});

export function resolveModelConfig(recommendation) {
  const config = MODEL_CONFIGS[recommendation];
  const validEfforts = config && VALID_CONCRETE_CONFIGS[config.model];
  if (!config || !validEfforts?.has(config.reasoning)) {
    throw new Error(`Unknown recommended configuration: ${recommendation}`);
  }
  return config;
}

const ROADMAP_FAMILIES = Object.freeze({
  historical: Object.freeze({ id: 'pre-1.0', major: 0 }),
  post1: Object.freeze({ id: 'post-1.0', major: 1 }),
  post2: Object.freeze({ id: 'post-2.0', major: 2 }),
});

export function roadmapVersionFor(plan, promptNumber) {
  return `${plan.roadmapMajor}.${plan.phase}.${promptNumber}`;
}

export function roadmapFamilyLabel(roadmapFamily) {
  switch (roadmapFamily) {
    case ROADMAP_FAMILIES.historical.id:
      return 'Historical pre-1.0';
    case ROADMAP_FAMILIES.post1.id:
      return 'Post-1.0';
    case ROADMAP_FAMILIES.post2.id:
      return 'Post-2.0';
    default:
      throw new Error(`Unknown roadmap family: ${roadmapFamily}`);
  }
}

function oneMatch(text, expression, label) {
  const matches = [...text.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  }
  return matches[0][1].trim();
}

export function parsePrompt(filename, text) {
  const fileMatch = /^P([1-9]\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)\.txt$/.exec(
    filename,
  );
  if (!fileMatch) {
    throw new Error(
      `Prompt filename must have the form P<number>-<lower-kebab-slug>.txt; numbering is one-based with no leading zero: ${filename}`,
    );
  }
  const number = Number(fileMatch[1]);
  const filenameSlug = fileMatch[2];
  const task = oneMatch(text, /^TASK:\s*(.+)$/gm, 'TASK title');
  const taskMatch =
    /^(Phase|Correction) (0|[1-9]\d*) \/ P([1-9]\d*) — (.+)$/u.exec(task);
  if (!taskMatch || !taskMatch[4].trim()) {
    throw new Error(
      `TASK title must have the form "Phase <phase> / P<number> — <title>" or "Correction <phase> / P<number> — <title>": ${filename}`,
    );
  }
  const mode = taskMatch[1] === 'Phase' ? 'phase' : 'correction';
  const taskPhase = Number(taskMatch[2]);
  const taskNumber = Number(taskMatch[3]);
  const title = taskMatch[4].trim();
  if (taskNumber !== number) {
    throw new Error(
      `TASK prompt number P${taskNumber} does not match filename P${number}: ${filename}`,
    );
  }

  const recommendation = oneMatch(
    text,
    /^- Recommended configuration: `([^`]+)`\.$/gm,
    'recommended configuration',
  );
  const config = resolveModelConfig(recommendation);
  const assignedVersionPhrases = [
    ...text.matchAll(/assigned project version is/gi),
  ];
  const unchangedVersionFields = [
    ...text.matchAll(/^- Required unchanged project version: `([^`]+)`\.$/gm),
  ];
  let versionPolicy;
  if (mode === 'phase') {
    if (unchangedVersionFields.length > 0) {
      throw new Error(
        `Phase prompt must not contain correction unchanged-version metadata: ${filename}`,
      );
    }
    if (assignedVersionPhrases.length !== 1) {
      throw new Error(
        `Expected exactly one assigned project version; found ${assignedVersionPhrases.length}.`,
      );
    }
    const targetVersion = oneMatch(
      text,
      /assigned project version is\s*`(\d+\.\d+\.\d+)`/gi,
      'assigned project version',
    );
    versionPolicy = { mode, targetVersion };
  } else {
    if (assignedVersionPhrases.length > 0) {
      throw new Error(
        `Correction prompt must not contain assigned project version metadata: ${filename}`,
      );
    }
    if (unchangedVersionFields.length !== 1) {
      throw new Error(
        `Expected exactly one required unchanged project version; found ${unchangedVersionFields.length}.`,
      );
    }
    const unchangedVersion = unchangedVersionFields[0][1].trim();
    if (
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(unchangedVersion)
    ) {
      throw new Error(
        `Required unchanged project version must be a semantic version: ${filename}`,
      );
    }
    versionPolicy = { mode, unchangedVersion };
  }

  const filenameSignal = /(?:^|-)closeout(?:-|$)/.test(filenameSlug);
  const titleSignal = /\bcloseout\b/i.test(title);
  if (filenameSignal !== titleSignal) {
    throw new Error(`Ambiguous closeout classification for ${filename}.`);
  }
  const kind = filenameSignal && titleSignal ? 'closeout' : 'implementation';

  return Object.freeze({
    number,
    filename,
    task,
    taskPhase,
    title,
    recommendation,
    ...config,
    ...versionPolicy,
    kind,
    text,
  });
}

export function buildPlan(entries, folderName) {
  const historicalPhaseFolderMatch = /^p([1-9]\d*)$/.exec(folderName);
  const post1PhaseFolderMatch = /^p1-(0|[1-9]\d*)$/.exec(folderName);
  const post2PhaseFolderMatch = /^p2-(0|[1-9]\d*)$/.exec(folderName);
  const correctionFolderMatch =
    /^c(0|[1-9]\d*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(folderName);
  if (
    !historicalPhaseFolderMatch &&
    !post1PhaseFolderMatch &&
    !post2PhaseFolderMatch &&
    !correctionFolderMatch
  ) {
    throw new Error(
      'Task folder must have the form p<number>, p1-<phase>, p2-<phase>, or c<phase>-<lower-kebab-slug>.',
    );
  }
  if (entries.length === 0) throw new Error('No prompt files were found.');
  const mode =
    historicalPhaseFolderMatch || post1PhaseFolderMatch || post2PhaseFolderMatch
      ? 'phase'
      : 'correction';
  const folderMatch =
    historicalPhaseFolderMatch ??
    post1PhaseFolderMatch ??
    post2PhaseFolderMatch ??
    correctionFolderMatch;
  const phase = Number(folderMatch[1]);
  const correctionSlug = correctionFolderMatch?.[2];
  const roadmapFamily = historicalPhaseFolderMatch
    ? ROADMAP_FAMILIES.historical
    : post1PhaseFolderMatch
      ? ROADMAP_FAMILIES.post1
      : post2PhaseFolderMatch
        ? ROADMAP_FAMILIES.post2
        : undefined;
  const prompts = entries.map(({ filename, text }) =>
    parsePrompt(filename, text),
  );
  prompts.sort((left, right) => left.number - right.number);
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    if (index && prompt.number === prompts[index - 1].number) {
      throw new Error(`Duplicate prompt number P${prompt.number}.`);
    }
    if (prompt.number !== index + 1) {
      throw new Error(
        `Prompt numbering must be contiguous from P1; expected P${index + 1}.`,
      );
    }
    if (prompt.taskPhase !== phase) {
      throw new Error(
        `P${prompt.number} TASK phase ${prompt.taskPhase} does not match folder phase ${phase}.`,
      );
    }
    if (prompt.mode !== mode) {
      throw new Error(
        `P${prompt.number} TASK stack mode ${prompt.mode} does not match folder stack mode ${mode}.`,
      );
    }
  }
  const closeouts = prompts.filter((prompt) => prompt.kind === 'closeout');
  if (closeouts.length !== 1 || prompts.at(-1).kind !== 'closeout') {
    throw new Error(
      'Exactly one unambiguous final closeout prompt is required.',
    );
  }
  let unchangedVersion;
  if (mode === 'phase') {
    const versionPlan = Object.freeze({
      phase,
      roadmapFamily: roadmapFamily.id,
      roadmapMajor: roadmapFamily.major,
    });
    for (const prompt of prompts) {
      const expected = roadmapVersionFor(versionPlan, prompt.number);
      if (prompt.targetVersion !== expected) {
        throw new Error(
          `P${prompt.number} target ${prompt.targetVersion} does not match ${expected}.`,
        );
      }
    }
  } else {
    unchangedVersion = prompts[0].unchangedVersion;
    for (const prompt of prompts) {
      if (prompt.unchangedVersion !== unchangedVersion) {
        throw new Error(
          `P${prompt.number} unchanged version ${prompt.unchangedVersion} does not match stack version ${unchangedVersion}.`,
        );
      }
    }
  }
  const immutablePrompts = Object.freeze(prompts);
  return Object.freeze({
    mode,
    phase,
    folderName,
    ...(mode === 'phase'
      ? {
          roadmapFamily: roadmapFamily.id,
          roadmapMajor: roadmapFamily.major,
        }
      : {}),
    ...(mode === 'correction' ? { correctionSlug, unchangedVersion } : {}),
    prompts: immutablePrompts,
    implementations: Object.freeze(immutablePrompts.slice(0, -1)),
    closeout: immutablePrompts.at(-1),
  });
}

export function assertVersionCompatible(actual, prompt, previousVersion) {
  if (prompt.mode === 'correction') {
    if (actual !== prompt.unchangedVersion) {
      throw new Error(
        `P${prompt.number} expected unchanged package version ${prompt.unchangedVersion}; found ${actual}.`,
      );
    }
    return;
  }
  if (actual !== previousVersion && actual !== prompt.targetVersion) {
    throw new Error(
      `P${prompt.number} expected package version ${previousVersion} (or ${prompt.targetVersion} for a rerun); found ${actual}.`,
    );
  }
}

export function promptCommitSubject(plan, prompt) {
  return plan.mode === 'phase'
    ? prompt.targetVersion
    : `${plan.folderName}/P${prompt.number}: ${prompt.title}`;
}

export function detectCompletedPromptPrefix(plan, history, packageVersion) {
  const matches = plan.implementations.map((prompt) => {
    const subject = promptCommitSubject(plan, prompt);
    const commits = history.filter((commit) => commit.subject === subject);
    if (plan.mode === 'correction' && commits.length > 1) {
      throw new Error(
        `Git history is ambiguous for P${prompt.number}: found ${commits.length} reachable commits with subject ${subject}.`,
      );
    }
    // Phase history comes from `git log`, newest-first. When an exact version
    // subject appears more than once, the newest reachable match is the marker.
    return commits[0];
  });

  const firstMissing = matches.findIndex((commit) => !commit);
  const completedCount = firstMissing === -1 ? matches.length : firstMissing;
  const laterMatch = matches.findIndex(
    (commit, index) => index > completedCount && Boolean(commit),
  );
  if (laterMatch !== -1) {
    throw new Error(
      `Git history is unsafe to resume: P${laterMatch + 1} is completed while P${completedCount + 1} is missing.`,
    );
  }

  const expectedVersion =
    plan.mode === 'phase'
      ? roadmapVersionFor(plan, completedCount)
      : plan.unchangedVersion;
  if (packageVersion !== expectedVersion) {
    if (plan.mode === 'correction') {
      throw new Error(
        `Correction stack expected unchanged package version ${expectedVersion}; found ${packageVersion}.`,
      );
    }
    throw new Error(
      `Package version ${packageVersion} does not match the Git-proven completed prefix through ${completedCount ? `P${completedCount}` : 'no prompts'}; expected ${expectedVersion}.`,
    );
  }

  return Object.freeze({
    completedCount,
    completed: Object.freeze(
      plan.implementations
        .slice(0, completedCount)
        .map((prompt, index) =>
          Object.freeze({ prompt, commitSha: matches[index].sha }),
        ),
    ),
    nextPrompt: plan.implementations[completedCount],
    previousVersion: expectedVersion,
  });
}

export function assertPostPrompt({
  exitCode,
  version,
  prompt,
  packageLockExists,
  coherent = true,
}) {
  if (exitCode !== 0) throw new Error(`Codex exited with status ${exitCode}.`);
  const expectedVersion =
    prompt.mode === 'correction'
      ? prompt.unchangedVersion
      : prompt.targetVersion;
  if (version !== expectedVersion) {
    throw new Error(
      `Expected ${prompt.mode === 'correction' ? 'unchanged ' : ''}package version ${expectedVersion}; found ${version}.`,
    );
  }
  if (packageLockExists) throw new Error('package-lock.json was created.');
  if (!coherent)
    throw new Error('Repository state is not coherent enough to continue.');
}

export function interpretEvent(event, verbose = false) {
  const item = event.item ?? event;
  const type = item.type ?? event.type ?? '';
  if (type === 'command_execution') {
    const command = item.command ?? item.cmd ?? 'command';
    const lifecycle = event.type ?? item.status ?? '';
    const completed =
      lifecycle === 'item.completed' || item.status === 'completed';
    return {
      visible: true,
      activity: `${completed ? '[+]' : '[>]'} ${completed ? 'Ran' : 'Running'}: ${command}`,
      command: {
        id: item.id,
        text: command,
        lifecycle,
        started: lifecycle === 'item.started' || item.status === 'in_progress',
        completed,
      },
    };
  }
  if (type === 'file_change') {
    const changes = item.changes ?? [item];
    const names = changes
      .map((change) => change.path ?? change.file_path)
      .filter(Boolean);
    return {
      visible: true,
      activity: names.map((name) => `[+] Modified ${name}`).join(' | '),
      files: names,
    };
  }
  if (type === 'agent_message') {
    const message = item.text ?? item.message ?? '';
    return {
      visible: Boolean(message) && verbose,
      activity: message,
      agentMessage: message,
    };
  }
  if (type === 'turn.completed')
    return {
      visible: true,
      activity: '[.] Codex turn completed',
      usage: event.usage,
    };
  if (type.includes('error') || event.error)
    return {
      visible: true,
      activity: `[X] ${event.message ?? event.error?.message ?? 'Codex error'}`,
    };
  return {
    visible: verbose && Boolean(type),
    activity: type ? `[.] ${type}` : '',
  };
}

export function createEventTracker() {
  return {
    commands: 0,
    commandIds: new Set(),
    anonymousCommands: new Map(),
    activeCommands: new Map(),
    files: new Set(),
    latestAgentMessage: '',
  };
}

export function applyEventObservation(tracker, observation, now = Date.now()) {
  if (observation.agentMessage?.trim()) {
    tracker.latestAgentMessage = observation.agentMessage;
  }
  for (const file of observation.files ?? []) tracker.files.add(file);
  const command = observation.command;
  if (!command) return;

  if (command.id) {
    if (!tracker.commandIds.has(command.id)) {
      tracker.commandIds.add(command.id);
      tracker.commands += 1;
    }
    if (command.started) {
      tracker.activeCommands.set(command.id, {
        text: command.text,
        startedAt: now,
      });
    }
    if (command.completed) tracker.activeCommands.delete(command.id);
    return;
  }

  const anonymousKey = String(command.text);
  if (command.started) {
    if (!tracker.anonymousCommands.has(anonymousKey)) tracker.commands += 1;
    tracker.anonymousCommands.set(anonymousKey, now);
    tracker.activeCommands.set(anonymousKey, {
      text: command.text,
      startedAt: now,
    });
  } else if (command.completed) {
    if (!tracker.anonymousCommands.has(anonymousKey)) tracker.commands += 1;
    tracker.anonymousCommands.delete(anonymousKey);
    tracker.activeCommands.delete(anonymousKey);
  }
}

export function createStructuredEventProcessor({ appendLine, onEvent }) {
  let buffer = '';
  let queue = Promise.resolve();
  let parseFailure;

  const enqueue = (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      await appendLine(`${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        parseFailure ??= new Error(
          `Unusable structured Codex output: ${error.message}`,
        );
        return;
      }
      await onEvent(event);
    });
  };

  return Object.freeze({
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) enqueue(line);
    },
    async finish() {
      if (buffer) enqueue(buffer);
      buffer = '';
      await queue;
      if (parseFailure) throw parseFailure;
    },
  });
}

export function printableAscii(value) {
  const replacements = new Map([
    ['—', '-'],
    ['–', '-'],
    ['‘', "'"],
    ['’', "'"],
    ['“', '"'],
    ['”', '"'],
    ['…', '...'],
    ['→', '->'],
  ]);
  return [...String(value)]
    .map((character) => {
      const replacement = replacements.get(character);
      if (replacement !== undefined) return replacement;
      const code = character.charCodeAt(0);
      return code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code <= 126)
        ? character
        : '?';
    })
    .join('');
}

const ANSI = Object.freeze({
  reset: '\u001B[0m',
  boldCyan: '\u001B[1;36m',
  cyan: '\u001B[36m',
  green: '\u001B[32m',
  dimGreen: '\u001B[2;32m',
  yellow: '\u001B[33m',
  red: '\u001B[31m',
  magenta: '\u001B[35m',
  dim: '\u001B[2m',
});

export function style(text, code, enabled = true) {
  return enabled && text ? `${code}${text}${ANSI.reset}` : text;
}

export function stripAnsi(value) {
  const escape = String.fromCharCode(27);
  return String(value).replace(new RegExp(`${escape}\\[[0-9;]*m`, 'g'), '');
}

function colorizeDashboardLine(line) {
  if (line === 'VIDGEN - CODEX TASK STACK RUNNER')
    return style(line, ANSI.boldCyan);
  if (/^[-=]+$/.test(line)) return style(line, ANSI.dim);
  if (line.startsWith('Agent:')) return style(line, ANSI.magenta);
  if (line.startsWith('Activity:')) return style(line, ANSI.cyan);
  if (/^\s*\[>\]/.test(line)) return style(line, ANSI.cyan);
  if (/^\s*\[\+\]/.test(line)) return style(line, ANSI.green);
  if (/^\s*\[X\]/.test(line)) return style(line, ANSI.red);
  if (/^\s*\[M\]/.test(line) || line.startsWith('Closeout:'))
    return style(line, ANSI.yellow);
  if (/^\s*\[ \]/.test(line)) return style(line, ANSI.dim);
  if (/^\s*Commit:/.test(line)) return style(line, ANSI.dimGreen);
  if (line.startsWith('Target:')) return style(line, ANSI.yellow);
  if (
    line.startsWith('Usage:') ||
    /^\s+(Input|Cached|Output|Reasoning)\s/.test(line)
  )
    return style(line, ANSI.dim);
  return line;
}

function formatAgentMessage(message, terminalWidth = 100) {
  const normalized = printableAscii(message).replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const availableWidth = Number.isFinite(terminalWidth) ? terminalWidth : 100;
  const width = Math.max(40, Math.min(110, availableWidth - 4));
  const maximum = Math.min(320, width * 3);
  const bounded =
    normalized.length > maximum
      ? `${normalized.slice(0, Math.max(0, maximum - 3)).trimEnd()}...`
      : normalized;
  const lines = [];
  let remaining = bounded;
  while (remaining && lines.length < 3) {
    if (remaining.length <= width) {
      lines.push(remaining);
      break;
    }
    const candidate = remaining.slice(0, width + 1);
    const space = candidate.lastIndexOf(' ');
    const breakAt = space > 0 ? space : width;
    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining && lines.length === 3 && !lines[2].endsWith('...')) {
    lines[2] = `${lines[2].slice(0, Math.max(0, width - 3)).trimEnd()}...`;
  }
  return lines;
}

export function formatElapsed(durationMs) {
  const seconds = Math.floor(Math.max(0, durationMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatUsage(usage) {
  if (!usage) return [];
  const fields = [
    ['Input', usage.input_tokens],
    ['Cached', usage.cached_input_tokens],
    ['Output', usage.output_tokens],
    ['Reasoning', usage.reasoning_output_tokens],
  ].filter(([, value]) => Number.isFinite(value));
  if (fields.length === 0) return [];
  return [
    'Usage:',
    ...fields.map(
      ([label, value]) =>
        `  ${String(label).padEnd(10)} ${String(value).padStart(8)}`,
    ),
  ];
}

function stateLabel(prompt, state) {
  if (prompt.kind === 'closeout') {
    if (state?.status === 'running') return '[>] RUNNING / CLOSEOUT';
    if (state?.status === 'review_required')
      return '[R] EXECUTED / REVIEW REQUIRED';
    if (state?.status === 'failed') return '[X] FAILED / CLOSEOUT';
    if (state?.status === 'interrupted') return '[X] INTERRUPTED / CLOSEOUT';
    if (state?.status === 'waiting') return '[ ] AUTO-RUN / HUMAN REVIEW';
    return '[M] MANUAL / CLOSEOUT';
  }
  if (state?.status === 'previously_completed')
    return '[+] PREVIOUSLY COMPLETED';
  if (state?.status === 'passed') return '[+] PASSED';
  if (state?.status === 'running') return '[>] RUNNING';
  if (state?.status === 'failed') return '[X] FAILED';
  if (state?.status === 'interrupted') return '[X] INTERRUPTED';
  return '[ ] WAITING';
}

function promptVersionLabel(prompt) {
  return prompt.mode === 'correction'
    ? `${prompt.unchangedVersion} (UNCHANGED)`
    : prompt.targetVersion;
}

export function renderDashboard({
  plan,
  states,
  current,
  activity,
  tracker,
  startedAt,
  now = Date.now(),
  terminalWidth = 100,
  colorEnabled = false,
  closeoutAutoRun = false,
}) {
  const lines = [
    'VIDGEN - CODEX TASK STACK RUNNER',
    '-'.repeat(60),
    '',
    ...(plan.mode === 'correction'
      ? [
          'Stack mode:   Correction',
          `Correction:   ${plan.folderName}`,
          `Roadmap phase:${String(plan.phase).padStart(3, ' ')}`,
          `Version:      ${plan.unchangedVersion} (UNCHANGED)`,
        ]
      : [
          `Roadmap:      ${roadmapFamilyLabel(plan.roadmapFamily)}`,
          `Phase:        ${plan.phase}`,
        ]),
    `Task folder:  docs/tasks/${plan.folderName}`,
    `Mode:         ${closeoutAutoRun ? 'Implementation prompts + final closeout' : 'Implementation prompts only'}`,
    `Closeout:     ${closeoutAutoRun ? 'AUTO-RUN / HUMAN REVIEW' : 'MANUAL'}`,
    '',
    'Prompts:',
  ];
  for (const prompt of plan.prompts) {
    const state = states.get(prompt.number);
    const duration =
      ['passed', 'review_required'].includes(state?.status) &&
      Number.isFinite(state.durationMs)
        ? `  ${formatElapsed(state.durationMs)}`
        : '';
    lines.push(
      `  ${stateLabel(prompt, state)} P${prompt.number}  ${prompt.title}  ${prompt.recommendation}  ${prompt.kind === 'closeout' ? (closeoutAutoRun ? 'AUTO-RUN' : 'MANUAL') : promptVersionLabel(prompt)}${duration}`,
    );
    if (
      state?.status === 'passed' ||
      state?.status === 'previously_completed' ||
      state?.status === 'review_required'
    ) {
      if (state.commitSha)
        lines.push(`    Commit: ${state.commitSha.slice(0, 7)}`);
      const usageLines = formatUsage(state.usage);
      if (usageLines.length > 0)
        lines.push(...usageLines.map((line) => `    ${line}`));
    }
  }
  const complete = [...states.values()].filter(
    (state) =>
      state.status === 'passed' || state.status === 'previously_completed',
  ).length;
  lines.push(
    '',
    `Overall: ${complete} / ${plan.implementations.length} implementation prompts complete`,
  );
  if (current) {
    const activeCommand = [...tracker.activeCommands.values()].at(-1);
    lines.push(
      '',
      '-'.repeat(60),
      current.kind === 'closeout'
        ? `CURRENT - CLOSEOUT P${current.number}`
        : `CURRENT - P${current.number} / ${plan.implementations.length}`,
      current.title,
      '',
      `Model:         ${current.recommendation.split(' ')[0]}`,
      `Reasoning:     ${current.recommendation.split(' ')[1]}`,
      `${current.mode === 'correction' ? 'Version:' : 'Target:'}        ${promptVersionLabel(current)}`,
      `Elapsed:       ${formatElapsed(now - startedAt)}`,
      '',
    );
    const agentLines = formatAgentMessage(
      tracker.latestAgentMessage,
      terminalWidth,
    );
    if (agentLines.length > 0) {
      lines.push('Agent:', ...agentLines.map((line) => `  ${line}`), '');
    }
    lines.push(
      'Activity:',
      `  ${activeCommand ? `[>] Running: ${activeCommand.text}` : activity || '[.] Waiting for Codex response'}`,
    );
    if (activeCommand)
      lines.push(`    elapsed ${formatElapsed(now - activeCommand.startedAt)}`);
    lines.push(
      '',
      `Files changed: ${tracker.files.size}`,
      `Commands run:  ${tracker.commands}`,
    );
  }
  lines.push('-'.repeat(60));
  const plain = printableAscii(lines.join('\n'));
  const rendered = colorEnabled
    ? plain.split('\n').map(colorizeDashboardLine).join('\n')
    : plain;
  return `${rendered}\n`;
}

function renderedLineCount(output) {
  return output.endsWith('\n')
    ? output.split('\n').length - 1
    : output.split('\n').length;
}

export function isColorEnabled({
  interactive,
  verbose = false,
  environment = process.env,
}) {
  return Boolean(
    interactive && !verbose && !Object.hasOwn(environment, 'NO_COLOR'),
  );
}

export function createDisplaySession({
  stream,
  interactive = Boolean(stream?.isTTY),
  verbose = false,
  colorEnabled = isColorEnabled({ interactive, verbose }),
  moveCursorFunction = moveCursor,
  cursorToFunction = cursorTo,
  clearScreenDownFunction = clearScreenDown,
}) {
  let previousLineCount = 0;
  let previousOutput = '';
  let finalized = false;
  const ownsInteractiveRegion = Boolean(interactive && !verbose);

  const write = (value) => stream.write(value);
  const normalize = (value) => {
    const ascii = colorEnabled
      ? String(value)
      : printableAscii(stripAnsi(value));
    return ascii.endsWith('\n') ? ascii : `${ascii}\n`;
  };

  return Object.freeze({
    get interactive() {
      return ownsInteractiveRegion;
    },
    render(value) {
      if (!ownsInteractiveRegion || finalized) return false;
      const output = normalize(value);
      if (output === previousOutput) return false;
      if (previousLineCount > 0) {
        moveCursorFunction(stream, 0, -previousLineCount);
        cursorToFunction(stream, 0);
        clearScreenDownFunction(stream);
      }
      write(output);
      previousLineCount = renderedLineCount(output);
      previousOutput = output;
      return true;
    },
    progress(value) {
      if (ownsInteractiveRegion || finalized) return false;
      write(normalize(value));
      return true;
    },
    verbose(value) {
      if (!verbose || finalized) return false;
      write(normalize(value));
      return true;
    },
    finalize(value) {
      if (finalized) return false;
      if (ownsInteractiveRegion && value !== undefined) this.render(value);
      finalized = true;
      return true;
    },
  });
}

export function startElapsedRedraw(
  redraw,
  {
    intervalMs = 1000,
    setIntervalFunction = globalThis.setInterval,
    clearIntervalFunction = globalThis.clearInterval,
  } = {},
) {
  const timer = setIntervalFunction(redraw, intervalMs);
  return () => clearIntervalFunction(timer);
}

export function renderFailureSummary({ plan, states, failedPrompt, reason }) {
  const lines = [
    '',
    '='.repeat(60),
    plan?.mode === 'correction'
      ? `CORRECTION STACK ${plan.folderName} STOPPED`
      : 'PHASE RUN STOPPED',
    '='.repeat(60),
    '',
  ];
  if (failedPrompt)
    lines.push(`[X] P${failedPrompt.number} - ${failedPrompt.title}`, '');
  lines.push('Reason:', `  ${reason}`, '', 'Completed:');
  const completed = plan?.implementations.filter(
    (prompt) =>
      states.get(prompt.number)?.status === 'passed' ||
      states.get(prompt.number)?.status === 'previously_completed',
  );
  if (completed?.length)
    lines.push(...completed.map((prompt) => `  [+] P${prompt.number}`));
  else lines.push('  (none)');
  lines.push('', 'Not executed:');
  const notExecuted = plan?.implementations.filter(
    (prompt) =>
      prompt.number !== failedPrompt?.number &&
      ![
        'passed',
        'previously_completed',
        'running',
        'failed',
        'interrupted',
      ].includes(states.get(prompt.number)?.status),
  );
  if (notExecuted?.length)
    lines.push(...notExecuted.map((prompt) => `  [ ] P${prompt.number}`));
  else lines.push('  (none)');
  lines.push('', 'Closeout:');
  const closeoutState = plan?.closeout && states.get(plan.closeout.number);
  if (plan?.closeout && closeoutState?.status === 'running')
    lines.push(
      `  [>] P${plan.closeout.number} - ${plan.closeout.title} - RUNNING`,
    );
  else if (plan?.closeout && closeoutState?.status === 'failed')
    lines.push(
      `  [X] P${plan.closeout.number} - ${plan.closeout.title} - FAILED`,
    );
  else if (plan?.closeout && closeoutState?.status === 'interrupted')
    lines.push(
      `  [X] P${plan.closeout.number} - ${plan.closeout.title} - INTERRUPTED`,
    );
  else if (plan?.closeout && closeoutState?.status === 'review_required')
    lines.push(
      `  [R] P${plan.closeout.number} - ${plan.closeout.title} - EXECUTED / REVIEW REQUIRED`,
    );
  else if (plan?.closeout && closeoutState?.status === 'waiting')
    lines.push(
      `  [ ] P${plan.closeout.number} - ${plan.closeout.title} - AUTO-RUN / NOT EXECUTED`,
    );
  else if (plan?.closeout)
    lines.push(
      `  [M] P${plan.closeout.number} - ${plan.closeout.title} - NOT EXECUTED`,
    );
  else lines.push('  [M] NOT EXECUTED');
  lines.push('', 'No later Codex prompts were started.');
  return `${printableAscii(lines.join('\n'))}\n`;
}

export function renderCloseoutFinalResponse(finalResponse) {
  return `\n${'='.repeat(60)}\nCLOSEOUT AGENT FINAL RESPONSE\n${'='.repeat(60)}\n${printableAscii(finalResponse)}`;
}

export function renderSuccessHandoff(plan, runDirectory) {
  if (plan.mode === 'correction') {
    return printableAscii(
      `\n${'='.repeat(60)}\nCORRECTION STACK ${plan.folderName} IMPLEMENTATION PROMPTS COMPLETE\n${'='.repeat(60)}\n\nAutomation stopped by design.\nVersion: ${plan.unchangedVersion} (UNCHANGED)\n[M] P${plan.closeout.number} - ${plan.closeout.title}\n    Recommended: ${plan.closeout.recommendation}\n    Version:     ${plan.closeout.unchangedVersion} (UNCHANGED)\n    Execution:   MANUAL\n\nRun this correction stack's closeout prompt manually when ready.\nIt clears only the correction gate; it does not run /closeout, advance the roadmap phase, or change package.json.\nLogs: ${runDirectory}\n`,
    );
  }
  return printableAscii(
    `\n${'='.repeat(60)}\n${roadmapFamilyLabel(plan.roadmapFamily).toUpperCase()} PHASE ${plan.phase} IMPLEMENTATION PROMPTS COMPLETE\n${'='.repeat(60)}\n\nAutomation stopped by design.\n[M] P${plan.closeout.number} - ${plan.closeout.title}\n    Recommended: ${plan.closeout.recommendation}\n    Target:      ${plan.closeout.targetVersion}\n    Execution:   MANUAL\n\nRun the closeout prompt manually when ready.\nLogs: ${runDirectory}\n`,
  );
}

export function hasCursorControls(text) {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`).test(text);
}

export function isAscii(text) {
  return [...text].every((character) => character.charCodeAt(0) <= 127);
}
