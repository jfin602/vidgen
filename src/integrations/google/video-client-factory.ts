import type { VideoGenerationClient } from '../../core/generated-media.ts';
import type { PresenterVideoGenerationClient } from '../../core/presenter-video.ts';
import { GoogleAgentPlatformVeoVideoGenerationClient } from './agent-platform-veo-video-generation.ts';

export type VideoBackendEnvironment = Readonly<Record<string, string | undefined>>;
export type ConfiguredVideoGenerationClient = VideoGenerationClient & PresenterVideoGenerationClient;

/** Constructs the sole configured Agent Platform video client. */
export function createConfiguredVideoClient(environment: VideoBackendEnvironment = process.env): ConfiguredVideoGenerationClient {
  return new GoogleAgentPlatformVeoVideoGenerationClient({ environment });
}
