import { readFile } from 'node:fs/promises';

import { VidGenError } from '../../core/error.ts';
import {
  validateNgestVidGenManifestPage,
  type NgestVidGenManifestPage,
} from './vidgen-manifest.ts';

/**
 * Loads one manually selected ngest-shaped manifest without requiring live
 * endpoint configuration. The producer envelope still has exactly one
 * validation path: validateNgestVidGenManifestPage.
 */
export async function loadNgestVidGenManifestFile(
  path: string,
): Promise<NgestVidGenManifestPage> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new VidGenError(
      'ngest_local_input',
      'Unable to read local Ngest VidGen manifest input.',
      { cause: error },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new VidGenError(
      'ngest_local_input',
      'Local Ngest VidGen manifest input contains invalid JSON.',
      { cause: error },
    );
  }

  return validateNgestVidGenManifestPage(value);
}
