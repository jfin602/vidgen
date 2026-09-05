import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const outputName = 'vidgen-docs-context.zip';
const repoRoot = process.cwd();
const outputPath = resolve(repoRoot, outputName);

function fail(message) {
  console.error(`docs:snapshot: ${message}`);
  process.exit(1);
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    fail(`unable to run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(detail || `git ${args[0]} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

const topLevel = runGit(['rev-parse', '--show-toplevel']).trim();
if (resolve(topLevel) !== resolve(repoRoot)) {
  fail('run this command from the repository root');
}

if (
  !existsSync(resolve(repoRoot, 'BOOT.md')) ||
  !existsSync(resolve(repoRoot, 'docs'))
) {
  fail('BOOT.md and docs/ must exist at the repository root');
}

const dirty = runGit([
  'status',
  '--porcelain',
  '--untracked-files=normal',
]).trim();
if (dirty !== '') {
  fail(
    'working tree must be clean so the snapshot exactly matches the committed repository state',
  );
}

const treeEntries = runGit(['ls-tree', '-z', 'HEAD'])
  .split('\0')
  .filter(Boolean)
  .map((entry) => {
    const match = entry.match(/^\d+\s+(\S+)\s+[0-9a-f]+\t(.+)$/);
    if (!match) {
      fail(`unable to parse git tree entry: ${entry}`);
    }
    return { type: match[1], path: match[2] };
  });

const rootFiles = treeEntries
  .filter(({ type, path }) => type === 'blob' && !path.includes('/'))
  .map(({ path }) => path)
  .sort((left, right) => left.localeCompare(right, 'en'));

const hasDocsTree = treeEntries.some(
  ({ type, path }) => type === 'tree' && path === 'docs',
);
if (!hasDocsTree) {
  fail('tracked docs/ tree is missing from HEAD');
}
if (!rootFiles.includes('BOOT.md')) {
  fail('tracked BOOT.md is missing from HEAD');
}

rmSync(outputPath, { force: true });

const archive = spawnSync(
  'git',
  [
    'archive',
    '--format=zip',
    `--output=${outputPath}`,
    'HEAD',
    '--',
    ...rootFiles,
    'docs',
  ],
  { cwd: repoRoot, encoding: 'utf8' },
);

if (archive.error) {
  rmSync(outputPath, { force: true });
  fail(`unable to create archive: ${archive.error.message}`);
}
if (archive.status !== 0) {
  const detail = (archive.stderr || archive.stdout || '').trim();
  rmSync(outputPath, { force: true });
  fail(detail || `git archive failed with exit code ${archive.status}`);
}

if (!existsSync(outputPath) || statSync(outputPath).size < 4) {
  rmSync(outputPath, { force: true });
  fail('archive was not created correctly');
}

const signature = readFileSync(outputPath).subarray(0, 4).toString('hex');
if (signature !== '504b0304') {
  rmSync(outputPath, { force: true });
  fail('archive validation failed: output is not a ZIP file');
}

const headSha = runGit(['rev-parse', '--short=12', 'HEAD']).trim();
console.log(`Created ${outputName}`);
console.log(`Source commit: ${headSha}`);
console.log(
  `Included ${rootFiles.length} tracked root files plus the complete tracked docs/ tree.`,
);
