import assert from 'node:assert/strict';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import { GoogleVeoVideoGenerationClient } from '../../../src/integrations/google/veo-video-generation.ts';
import { createConfiguredVideoClient, VIDGEN_VIDEO_BACKEND_ENV } from '../../../src/integrations/google/video-client-factory.ts';
import { VertexVeoVideoGenerationClient } from '../../../src/integrations/google/vertex-veo-video-generation.ts';

test('omitted and explicit developer backend construct the existing Developer API client without reading Vertex configuration', () => {
  for (const backend of [undefined, 'developer']) {
    const environment = guardedEnvironment(backend, { GEMINI_API_KEY: 'developer-key', VIDGEN_VIDEO_MODEL: 'veo-test-model' });
    assert.ok(createConfiguredVideoClient(environment) instanceof GoogleVeoVideoGenerationClient);
  }
});

test('vertex backend constructs the Vertex adapter without a Developer API key', () => {
  const client = createConfiguredVideoClient({
    [VIDGEN_VIDEO_BACKEND_ENV]: 'vertex', GOOGLE_CLOUD_PROJECT: 'valid-project', GOOGLE_CLOUD_LOCATION: 'us-central1', VIDGEN_VERTEX_VIDEO_MODEL: 'veo-3.1-generate-001',
  });
  assert.ok(client instanceof VertexVeoVideoGenerationClient);
  assert.equal(client.provider, 'vertex-veo');
  assert.equal(client.model, 'veo-3.1-generate-001');
});

test('invalid or blank backend fails before either backend configuration is inspected', () => {
  for (const backend of ['', 'Developer', 'developer ']) {
    assert.throws(() => createConfiguredVideoClient(guardedEnvironment(backend)), (error: unknown) =>
      error instanceof VidGenError && error.code === 'configuration' && error.publicMessage === 'VIDGEN_VIDEO_BACKEND must be "developer" or "vertex".',
    );
  }
});

function guardedEnvironment(backend: string | undefined, values: Record<string, string> = {}) {
  return new Proxy({ ...values, ...(backend === undefined ? {} : { [VIDGEN_VIDEO_BACKEND_ENV]: backend }) }, {
    get(target, property) {
      if (property === 'GOOGLE_CLOUD_PROJECT' || property === 'GOOGLE_CLOUD_LOCATION' || property === 'VIDGEN_VERTEX_VIDEO_MODEL') {
        throw new Error(`unexpected Vertex environment access: ${String(property)}`);
      }
      return target[property as keyof typeof target];
    },
  });
}
