import type { VideoGenerationClient } from '../../core/generated-media.ts';
import type { PresenterVideoGenerationClient } from '../../core/presenter-video.ts';
import { VidGenError } from '../../core/error.ts';
import { GoogleVeoVideoGenerationClient } from './veo-video-generation.ts';
import { VertexVeoVideoGenerationClient } from './vertex-veo-video-generation.ts';

export const VIDGEN_VIDEO_BACKEND_ENV = 'VIDGEN_VIDEO_BACKEND';
export type VideoBackendEnvironment = Readonly<Record<string, string | undefined>>;
export type ConfiguredVideoGenerationClient = VideoGenerationClient & PresenterVideoGenerationClient;

/** Selects the one configured video backend; provider failures never cross this boundary. */
export function createConfiguredVideoClient(environment: VideoBackendEnvironment = process.env): ConfiguredVideoGenerationClient {
  switch (environment[VIDGEN_VIDEO_BACKEND_ENV]) {
    case undefined:
    case 'developer':
      return new GoogleVeoVideoGenerationClient({ environment });
    case 'vertex':
      return new VertexVeoVideoGenerationClient({ environment });
    default:
      throw new VidGenError('configuration', 'VIDGEN_VIDEO_BACKEND must be "developer" or "vertex".');
  }
}
