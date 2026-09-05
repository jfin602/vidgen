import { randomUUID } from 'node:crypto';

/** The minimal filesystem capability needed to publish one JSON artifact. */
export interface AtomicJsonFilesystem {
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

/**
 * Serializes before creating a temp file, then publishes the finished JSON
 * with a rename. Callers own directory creation and artifact lifecycle.
 */
export async function writeJsonAtomically(
  filesystem: AtomicJsonFilesystem,
  finalPath: string,
  value: unknown,
  serializeJson: (value: unknown) => string = prettyJson,
  createTemporarySuffix: () => string = randomUUID,
): Promise<void> {
  const contents = `${serializeJson(value)}\n`;
  const temporaryPath = `${finalPath}.tmp-${createTemporarySuffix()}`;
  let temporaryFileCreated = false;

  try {
    await filesystem.writeFile(temporaryPath, contents, 'utf8');
    temporaryFileCreated = true;
    await filesystem.rename(temporaryPath, finalPath);
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await filesystem.unlink(temporaryPath);
      } catch {
        // A failed cleanup must not replace the useful persistence failure.
      }
    }
    throw error;
  }
}

export function prettyJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError('Value is not JSON-serializable.');
  }
  return serialized;
}
