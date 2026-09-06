import { resolve } from 'node:path';

import { createSampleStoryFixture } from '../src/app/sample-story-fixture.ts';
import { isVidGenError } from '../src/core/error.ts';

const args = process.argv.slice(2);
if (args.length !== 1) {
  process.stderr.write('Sample story requires exactly one absolute HTTP(S) Article URL.\n');
  process.exitCode = 2;
} else {
  try {
    const result = await createSampleStoryFixture({ articleUrl: args[0]! });
    process.stdout.write(
      `articleId: ${result.articleId}\n`
      + `fixture: ${result.outputPath}\n`
      + `next: npm run vidgen -- story --input-file ${result.outputPath} --article-id ${result.articleId}\n`,
    );
  } catch (error) {
    process.stderr.write(`${isVidGenError(error) ? error.publicMessage : 'Sample story fixture creation failed unexpectedly.'}\n`);
    process.exitCode = 2;
  }
}
