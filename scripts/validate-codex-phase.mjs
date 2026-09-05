import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPlan, roadmapFamilyLabel } from './codex-phase-core.mjs';

const folderName = process.argv[2];
if (!folderName || process.argv.length !== 3) {
  throw new Error('Usage: npm run codex:phase:validate -- <task-folder>');
}

const taskDirectory = path.join(process.cwd(), 'docs', 'tasks', folderName);
const names = await readdir(taskDirectory);
const textFiles = names.filter((name) => name.toLowerCase().endsWith('.txt'));
const entries = await Promise.all(
  textFiles.map(async (filename) => ({
    filename,
    text: await readFile(path.join(taskDirectory, filename), 'utf8'),
  })),
);
const plan = buildPlan(entries, folderName);

console.log(
  plan.mode === 'correction'
    ? `Correction stack ${plan.folderName} (roadmap phase ${plan.phase}) prompt grammar: VALID`
    : `${roadmapFamilyLabel(plan.roadmapFamily)} Phase ${plan.phase} prompt grammar: VALID`,
);
if (plan.mode === 'correction') {
  console.log(`Required unchanged version: ${plan.unchangedVersion}`);
}
for (const prompt of plan.prompts) {
  console.log(
    `P${prompt.number} | ${prompt.kind} | ${prompt.recommendation} | ${prompt.mode === 'correction' ? `${prompt.unchangedVersion} (UNCHANGED)` : prompt.targetVersion} | ${prompt.filename}`,
  );
}
console.log(`Manual closeout: P${plan.closeout.number}`);
