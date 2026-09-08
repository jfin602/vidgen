import { spawn as nodeSpawn } from 'node:child_process';

import { VidGenError } from '../core/error.ts';

export type PosterPlatform = 'bluesky' | 'meta' | 'x';
export type PosterCommandRunner = (arguments_: readonly string[]) => Promise<void>;

/** Runs the separately installed Poster CLI without accepting its diagnostics as VidGen data. */
export const runPosterCommand: PosterCommandRunner = async (arguments_) => {
  const root = process.env.VIDGEN_POSTER_ROOT?.trim();
  if (!root) throw new VidGenError('configuration', 'VIDGEN_POSTER_ROOT must name the VidGen Poster installation root.');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new VidGenError('unexpected', 'VidGen Poster command failed.')); } };
    try {
      const child = nodeSpawn(process.execPath, ['--env-file-if-exists=.env', 'src/cli.ts', ...arguments_], { cwd: root, shell: false, windowsHide: true, stdio: 'ignore' });
      child.once('error', fail);
      child.once('exit', (code) => { if (code === 0 && !settled) { settled = true; resolve(); } else fail(); });
    } catch { fail(); }
  });
};
