import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_ARTIFACTS_ROOT, runPhase1Input } from './app/phase-1-input-run.ts';
import {
  DEFAULT_STORY_ARTIFACTS_ROOT,
  createStoryWorkspace,
} from './app/story-workspace.ts';
import { planStoryWorkspace } from './app/clip-plan-workflow.ts';
import { generateStoryMedia } from './app/media-workflow.ts';
import { assembleStoryWorkspace } from './app/assembly-workflow.ts';
import { DEFAULT_HEADLINE_ARTIFACTS_ROOT, generateHeadlineClip } from './app/headline-workflow.ts';
import { isVidGenError, VidGenError } from './core/error.ts';

export const helpText = `VidGen

Usage:
  vidgen [--help]
  vidgen run [--artifacts-root <directory>]
  vidgen story --input-file <manifest.json> --article-id <articleId> [--template <templateId>] [--artifacts-root <directory>]
  vidgen plan --input-file <manifest.json> --article-id <articleId> [--template <templateId>] [--artifacts-root <directory>]
  vidgen media --story-dir <directory> [--anchor-reference <image-path> ...]
  vidgen assemble --story-dir <directory> [--intro <intro-video-path>] [--outro <outro-video-path>] [--font-file <font-path>]
  vidgen headline --input-file <manifest.json> --article-id <articleId> [--max-seconds <4-20>] --anchor-reference <image-path> [--anchor-reference <image-path> ...] --font-file <font-path> [--artifacts-root <directory>]

Available commands:
  help, --help, -h  Show this help message.
  run              Acquire one manifest and persist its CanonicalInput.
  story            Create one selected story development workspace from a local manifest.
  plan             Create one selected story workspace and generate its ClipPlan.
  media            Generate raw story-local media from an existing ClipPlan.
  assemble         Assemble an existing media-ready story and write final/clip.mp4.
  headline         Generate one finished presenter-headline MP4 and metadata sidecar.

Run options:
  --artifacts-root <directory>  Write runs here (default: ${DEFAULT_ARTIFACTS_ROOT}).
  Live input uses NGEST_BASE_URL, NGEST_PROFILE_KEY, and NGEST_BEARER_TOKEN.
  NGEST_TIMEOUT_MS is optional; a repository .env is loaded when present.

Story options:
  --input-file <manifest.json>  Required local ngest-shaped manifest file.
  --article-id <articleId>      Required explicit Article ID to select.
  --template <templateId>       Assembly template (default: default-news-40s).
  --artifacts-root <directory>  Write story workspaces here (default: ${DEFAULT_STORY_ARTIFACTS_ROOT}).

Plan options:
  --input-file <manifest.json>  Required local ngest-shaped manifest file.
  --article-id <articleId>      Required explicit Article ID to select.
  --template <templateId>       Assembly template (default: default-news-40s).
  --artifacts-root <directory>  Write story workspaces here (default: ${DEFAULT_STORY_ARTIFACTS_ROOT}).
  Model credentials and model selection are read from the runtime environment.

Media options:
  --story-dir <directory>          Required existing planned story workspace.
  --anchor-reference <image-path>  Approved local presenter image; repeat up to three times.
  Provider credentials, models, and voice are read from the runtime environment.
  Media writes raw generated assets only; FFmpeg assembly happens later.

Assemble options:
  --story-dir <directory>  Required existing media-ready story workspace.
  --intro <video-path>     Optional local standardized intro video.
  --outro <video-path>     Optional local standardized outro video.
  --font-file <font-path>  Required only when the selected assembly has display text.
  Assemble consumes an existing media-ready story and writes final/clip.mp4.

Headline options:
  --input-file <manifest.json>  Required local ngest-shaped manifest file.
  --article-id <articleId>      Required explicit Article ID to select.
  --max-seconds <4-20>          Final duration ceiling (default: 20).
  --anchor-reference <path>     Required local presenter image; repeat one to three times.
  --font-file <font-path>       Required local lower-third font.
  --artifacts-root <directory>  Write flat pairs here (default: ${DEFAULT_HEADLINE_ARTIFACTS_ROOT}).
`;

export interface HelpCommand {
  readonly kind: 'help';
}

export interface RunCommand {
  readonly kind: 'run';
  readonly artifactsRoot?: string;
}

export interface StoryCommand {
  readonly kind: 'story';
  readonly inputFile: string;
  readonly articleId: string;
  readonly templateId?: string;
  readonly artifactsRoot?: string;
}

export interface PlanCommand {
  readonly kind: 'plan';
  readonly inputFile: string;
  readonly articleId: string;
  readonly templateId?: string;
  readonly artifactsRoot?: string;
}

export interface MediaCommand {
  readonly kind: 'media';
  readonly storyDirectory: string;
  readonly anchorReferencePaths: readonly string[];
}

export interface AssembleCommand {
  readonly kind: 'assemble';
  readonly storyDirectory: string;
  readonly introPath?: string;
  readonly outroPath?: string;
  readonly fontPath?: string;
}
export interface HeadlineCommand { readonly kind: 'headline'; readonly inputFile: string; readonly articleId: string; readonly maxSeconds: number; readonly anchorReferencePaths: readonly string[]; readonly fontPath: string; readonly artifactsRoot?: string; }

export type CliCommand = HelpCommand | RunCommand | StoryCommand | PlanCommand | MediaCommand | AssembleCommand | HeadlineCommand;

export interface CliOutput {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/**
 * Parses the CLI surface without placing transport or persistence work here.
 */
export function parseCliArgs(args: readonly string[]): CliCommand {
  if (args.length === 0) {
    return { kind: 'help' };
  }

  const [command, ...rest] = args;
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      if (rest.length === 0) return { kind: 'help' };
      throw invalidArgument(`Help does not accept arguments: ${formatArgs(rest)}.`);
    case 'run': return parseRunCommand(rest);
    case 'story': return parseStoryCommand(rest);
    case 'plan': return { ...parseStoryCommand(rest, 'Plan'), kind: 'plan' };
    case 'media': return parseMediaCommand(rest);
    case 'assemble': return parseAssembleCommand(rest);
    case 'headline': return parseHeadlineCommand(rest);
    default:
      if (command.startsWith('-')) {
        throw invalidArgument(`Unknown argument: ${JSON.stringify(command)}.`);
      }
      throw invalidArgument(`Unknown command: ${JSON.stringify(command)}.`);
  }
}

export interface CliDependencies {
  readonly runInput?: typeof runPhase1Input;
  readonly createStory?: typeof createStoryWorkspace;
  readonly planStory?: typeof planStoryWorkspace;
  readonly generateMedia?: typeof generateStoryMedia;
  readonly assembleStory?: typeof assembleStoryWorkspace;
  readonly generateHeadline?: typeof generateHeadlineClip;
}

export async function runCli(
  args: readonly string[],
  output: CliOutput,
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const command = parseCliArgs(args);
    if (command.kind === 'help') {
      output.writeStdout(helpText);
      return 0;
    }

    if (command.kind === 'run') {
      const result = await (dependencies.runInput ?? runPhase1Input)({
        ...(command.artifactsRoot === undefined ? {} : { artifactsRoot: command.artifactsRoot }),
      });
      output.writeStdout(
        `Run ${result.runId} is input_ready.\n`
        + `inputFingerprint: ${result.inputFingerprint}\n`
        + `artifacts: ${result.runDirectory}\n`,
      );
      return 0;
    }

    if (command.kind === 'plan') {
      const result = await (dependencies.planStory ?? planStoryWorkspace)({
        inputFile: command.inputFile,
        articleId: command.articleId,
        ...(command.templateId === undefined ? {} : { templateId: command.templateId }),
        ...(command.artifactsRoot === undefined ? {} : { artifactsRoot: command.artifactsRoot }),
      });
      output.writeStdout(
        `Story ${result.story.storyRunId} is clip_plan_ready.\n`
        + `storyFingerprint: ${result.clipPlan.storyFingerprint}\n`
        + `template: ${result.clipPlan.template.id}@${result.clipPlan.template.version}\n`
        + `clipPlan: ${result.clipPlanPath}\n`,
      );
      return 0;
    }

    if (command.kind === 'media') {
      const result = await (dependencies.generateMedia ?? generateStoryMedia)({
        storyDirectory: command.storyDirectory,
        anchorReferencePaths: command.anchorReferencePaths,
      });
      output.writeStdout(
        `Story ${result.storyRunId} is media_ready.\n`
        + `generated: ${result.generatedUnitCount}\n`
        + `reused: ${result.reusedUnitCount}\n`
        + `generatedMedia: ${result.manifestPath}\n`,
      );
      return 0;
    }

    if (command.kind === 'assemble') {
      const result = await (dependencies.assembleStory ?? assembleStoryWorkspace)({
        storyDirectory: command.storyDirectory,
        ...(command.introPath === undefined ? {} : { introPath: command.introPath }),
        ...(command.outroPath === undefined ? {} : { outroPath: command.outroPath }),
        ...(command.fontPath === undefined ? {} : { fontPath: command.fontPath }),
      });
      output.writeStdout(
        `Story ${result.storyRunId} is final_ready.\n`
        + `assemblyRunId: ${result.assemblyRunId}\n`
        + `final: ${result.finalPath}\n`
        + `sha256: ${result.finalSha256}\n`
        + `durationSeconds: ${result.durationSeconds}\n`,
      );
      return 0;
    }
    if (command.kind === 'headline') {
      const result = await (dependencies.generateHeadline ?? generateHeadlineClip)({ inputFile: command.inputFile, articleId: command.articleId, maxSeconds: command.maxSeconds, anchorReferencePaths: command.anchorReferencePaths, fontPath: command.fontPath, ...(command.artifactsRoot === undefined ? {} : { artifactsRoot: command.artifactsRoot }) });
      output.writeStdout(`Headline ${result.clipId} is final_ready.\nfinal: ${result.finalPath}\nmetadata: ${result.metadataPath}\nsha256: ${result.sha256}\ndurationSeconds: ${result.durationSeconds}\n`);
      return 0;
    }

    const result = await (dependencies.createStory ?? createStoryWorkspace)({
      inputFile: command.inputFile,
      articleId: command.articleId,
      ...(command.templateId === undefined ? {} : { templateId: command.templateId }),
      ...(command.artifactsRoot === undefined ? {} : { artifactsRoot: command.artifactsRoot }),
    });
    output.writeStdout(
      `Story ${result.storyRunId} is story_ready.\n`
      + `storyFingerprint: ${result.storyInput.storyFingerprint}\n`
      + `template: ${result.template.id}@${result.template.version}\n`
      + `artifacts: ${result.storyDirectory}\n`,
    );
    return 0;
  } catch (error) {
    const message = isVidGenError(error)
      ? error.publicMessage
      : 'VidGen failed unexpectedly.';
    const category = isVidGenError(error) ? error.code : 'unexpected';
    output.writeStderr(`Run failed [${category}]: ${message} Run "vidgen --help" for usage.\n`);
    return 2;
  }
}

function parseHeadlineCommand(args: readonly string[]): HeadlineCommand {
  const values: Partial<Record<'inputFile' | 'articleId' | 'fontPath' | 'artifactsRoot' | 'maxSeconds', string>> = {};
  const anchors: string[] = [];
  const names: Record<string, keyof typeof values | 'anchor'> = { '--input-file': 'inputFile', '--article-id': 'articleId', '--font-file': 'fontPath', '--artifacts-root': 'artifactsRoot', '--max-seconds': 'maxSeconds', '--anchor-reference': 'anchor' };
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i]; const key = names[option ?? '']; const value = args[i + 1];
    if (key === undefined) throw invalidArgument(`Unknown headline argument: ${JSON.stringify(option)}.`);
    if (value === undefined || value.trim().length === 0) throw invalidArgument(`${option} requires exactly one non-empty value.`);
    if (key === 'anchor') { if (anchors.length >= 3) throw invalidArgument('Headline accepts at most three --anchor-reference values.'); anchors.push(value); }
    else { if (values[key] !== undefined) throw invalidArgument(`Headline option ${option} must not be repeated.`); values[key] = value; }
  }
  if (values.inputFile === undefined) throw invalidArgument('Headline requires --input-file <manifest.json>.');
  if (values.articleId === undefined) throw invalidArgument('Headline requires --article-id <articleId>.');
  if (values.fontPath === undefined) throw invalidArgument('Headline requires --font-file <font-path>.');
  if (anchors.length === 0) throw invalidArgument('Headline requires one to three --anchor-reference values.');
  const maxSeconds = values.maxSeconds === undefined ? 20 : Number(values.maxSeconds);
  if (!Number.isInteger(maxSeconds) || maxSeconds < 4 || maxSeconds > 20) throw invalidArgument('Headline --max-seconds must be a whole number from 4 through 20.');
  return { kind: 'headline', inputFile: values.inputFile, articleId: values.articleId, fontPath: values.fontPath, maxSeconds, anchorReferencePaths: anchors, ...(values.artifactsRoot === undefined ? {} : { artifactsRoot: values.artifactsRoot }) };
}

function parseMediaCommand(args: readonly string[]): MediaCommand {
  let storyDirectory: string | undefined;
  const anchorReferencePaths: string[] = [];
  for (let index = 0; index < args.length;) {
    const option = args[index];
    const value = args[index + 1];
    if (option !== '--story-dir' && option !== '--anchor-reference') {
      throw invalidArgument(`Unknown media argument: ${JSON.stringify(option)}.`);
    }
    if (value === undefined || value.trim().length === 0) {
      throw invalidArgument(`${option} requires exactly one value.`);
    }
    if (option === '--story-dir') {
      if (storyDirectory !== undefined) throw invalidArgument('Media option --story-dir must not be repeated.');
      storyDirectory = value;
    } else {
      if (anchorReferencePaths.length >= 3) throw invalidArgument('Media accepts at most three --anchor-reference values.');
      anchorReferencePaths.push(value);
    }
    index += 2;
  }
  if (storyDirectory === undefined) throw invalidArgument('Media requires --story-dir <directory>.');
  return { kind: 'media', storyDirectory, anchorReferencePaths };
}

function parseAssembleCommand(args: readonly string[]): AssembleCommand {
  const values: Partial<Record<'storyDirectory' | 'introPath' | 'outroPath' | 'fontPath', string>> = {};
  const optionNames: Record<string, keyof typeof values> = {
    '--story-dir': 'storyDirectory', '--intro': 'introPath', '--outro': 'outroPath', '--font-file': 'fontPath',
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const key = optionNames[option ?? ''];
    if (key === undefined) throw invalidArgument(`Unknown assemble argument: ${JSON.stringify(option)}.`);
    if (values[key] !== undefined) throw invalidArgument(`Assemble option ${option} must not be repeated.`);
    const value = args[index + 1];
    if (value === undefined || value.trim().length === 0) throw invalidArgument(`${option} requires exactly one non-empty value.`);
    values[key] = value;
  }
  if (values.storyDirectory === undefined) throw invalidArgument('Assemble requires --story-dir <directory>.');
  return { kind: 'assemble', storyDirectory: values.storyDirectory, ...(values.introPath === undefined ? {} : { introPath: values.introPath }), ...(values.outroPath === undefined ? {} : { outroPath: values.outroPath }), ...(values.fontPath === undefined ? {} : { fontPath: values.fontPath }) };
}

function parseRunCommand(args: readonly string[]): RunCommand {
  if (args.length === 0) {
    return { kind: 'run' };
  }

  if (args.length === 2 && args[0] === '--artifacts-root') {
    const artifactsRoot = args[1]?.trim();
    if (artifactsRoot === undefined || artifactsRoot.length === 0) {
      throw invalidArgument('--artifacts-root requires a non-empty directory.');
    }
    return { kind: 'run', artifactsRoot };
  }

  if (args[0] === '--artifacts-root') {
    throw invalidArgument('--artifacts-root requires exactly one directory argument.');
  }

  throw invalidArgument(`Run does not accept arguments: ${formatArgs(args)}.`);
}

function parseStoryCommand(args: readonly string[], commandName = 'Story'): StoryCommand {
  const values: Partial<Record<'inputFile' | 'articleId' | 'templateId' | 'artifactsRoot', string>> = {};
  const optionNames: Record<string, keyof typeof values> = {
    '--input-file': 'inputFile',
    '--article-id': 'articleId',
    '--template': 'templateId',
    '--artifacts-root': 'artifactsRoot',
  };

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const key = optionNames[option ?? ''];
    if (key === undefined) {
      throw invalidArgument(`Unknown ${commandName.toLowerCase()} argument: ${JSON.stringify(option)}.`);
    }
    if (values[key] !== undefined) {
      throw invalidArgument(`${commandName} option ${option} must not be repeated.`);
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw invalidArgument(`${option} requires exactly one value.`);
    }
    if (value.trim().length === 0) {
      throw invalidArgument(`${option} requires a non-empty value.`);
    }
    values[key] = value;
  }

  if (values.inputFile === undefined) {
    throw invalidArgument(`${commandName} requires --input-file <manifest.json>.`);
  }
  if (values.articleId === undefined) {
    throw invalidArgument(`${commandName} requires --article-id <articleId>.`);
  }

  return {
    kind: 'story',
    inputFile: values.inputFile,
    articleId: values.articleId,
    ...(values.templateId === undefined ? {} : { templateId: values.templateId }),
    ...(values.artifactsRoot === undefined ? {} : { artifactsRoot: values.artifactsRoot }),
  };
}

function invalidArgument(detail: string): VidGenError {
  return new VidGenError('invalid_argument', detail);
}

function formatArgs(args: readonly string[]): string {
  return args.map((arg) => JSON.stringify(arg)).join(', ');
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined
    && import.meta.url === pathToFileURL(resolve(entrypoint)).href;
}

if (isEntrypoint()) {
  process.exitCode = await runCli(process.argv.slice(2), {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  });
}
