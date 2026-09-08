import assert from 'node:assert/strict';
import test from 'node:test';

import { GoogleAgentPlatformVeoVideoGenerationClient } from '../../../src/integrations/google/agent-platform-veo-video-generation.ts';
import { createConfiguredVideoClient } from '../../../src/integrations/google/video-client-factory.ts';
import { join } from 'node:path';

test('the factory constructs only Agent Platform Veo without a Developer API key or backend selector', () => {
  const client = createConfiguredVideoClient({
    GOOGLE_CLOUD_PROJECT: 'valid-project', GOOGLE_CLOUD_LOCATION: 'us-central1', VIDGEN_VIDEO_MODEL: 'veo-3.1-generate-001', VIDGEN_VEO_PROMPT_FILE: join(process.cwd(), 'test', 'fixtures', 'veo-prompts.json'),
  });
  assert.ok(client instanceof GoogleAgentPlatformVeoVideoGenerationClient);
  assert.equal(client.provider, 'google-agent-platform-veo');
  assert.equal(client.model, 'veo-3.1-generate-001');
});
