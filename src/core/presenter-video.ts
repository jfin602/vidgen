import { assertApprovedAnchorReferenceCount, assertApprovedReferenceImage, type ApprovedReferenceImage } from './anchor-reference.ts';
import { VidGenError } from './error.ts';
import type { VeoPromptAssetIdentity } from './generated-media.ts';
import {
  assertSimpleClipMaxSeconds,
  SIMPLE_CLIP_BROADCAST_WORDS_PER_MINUTE,
  SIMPLE_CLIP_REALIZABLE_MAX_SECONDS,
} from './simple-clip-copy.ts';

const INITIAL_VEO_DURATION_SECONDS = 8;
const VEO_EXTENSION_DURATION_SECONDS = 7;
const SIMPLE_PRESENTER_WORDS_PER_SECOND = SIMPLE_CLIP_BROADCAST_WORDS_PER_MINUTE / 60;
const SIMPLE_PRESENTER_CONTINUITY_WORDS = Math.floor((INITIAL_VEO_DURATION_SECONDS - 1) * SIMPLE_PRESENTER_WORDS_PER_SECOND) + 1;

export interface PresenterVideoDurationPlan {
  /** Word-count planning ceiling; it selects provider coverage but does not trim media. */
  readonly speechPlanningCeilingSeconds: number;
  /** Coverage requested from the current provider before deterministic finishing. */
  readonly rawProviderDurationSeconds: number;
  readonly extensionCount: 0 | 1;
}

export interface PresenterVideoGenerationRequest {
  readonly spokenText: string;
  readonly referenceImages: readonly ApprovedReferenceImage[];
  readonly maxSeconds: number;
}

export interface PresenterVideoGenerationResult {
  readonly provider: string;
  readonly model: string;
  readonly requestId?: string;
  readonly operationId?: string;
  readonly operationIds?: readonly string[];
  readonly generationOperationCount?: number;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /** Raw provider coverage retained by the final simple clip. */
  readonly rawDurationSeconds: number;
  readonly durationPlan: PresenterVideoDurationPlan;
}

/** A narrow simple-path boundary; it never accepts cinematic media units. */
export interface PresenterVideoGenerationClient {
  readonly provider: string;
  readonly model: string;
  readonly promptAssetIdentity: VeoPromptAssetIdentity;
  generatePresenterVideo(request: PresenterVideoGenerationRequest): Promise<PresenterVideoGenerationResult>;
}

/**
 * Current Veo reference-image coverage: an 8-second initial video, with one
 * 7-second extension where useful. The returned provider media is retained
 * through its full timeline by the later finishing step.
 */
export function planPresenterVideoDuration(maxSeconds: number): PresenterVideoDurationPlan {
  assertSimpleClipMaxSeconds(maxSeconds);
  const extensionCount: 0 | 1 = maxSeconds <= INITIAL_VEO_DURATION_SECONDS ? 0 : 1;
  const rawProviderDurationSeconds = INITIAL_VEO_DURATION_SECONDS + (extensionCount * VEO_EXTENSION_DURATION_SECONDS);
  return {
    speechPlanningCeilingSeconds: maxSeconds,
    rawProviderDurationSeconds,
    extensionCount,
  };
}

export function assertPresenterVideoGenerationRequest(request: PresenterVideoGenerationRequest): void {
  if (request === null || typeof request !== 'object') {
    throw invalidPresenterVideo('Presenter video generation request is invalid.');
  }
  assertSimpleClipMaxSeconds(request.maxSeconds);
  if (typeof request.spokenText !== 'string' || request.spokenText.length === 0 || request.spokenText.trim() !== request.spokenText) {
    throw invalidPresenterVideo('Presenter video generation requires exact non-blank spoken text.');
  }
  if (!Array.isArray(request.referenceImages)) {
    throw invalidPresenterVideo('Presenter video generation requires one to three approved local anchor references.');
  }
  try {
    assertApprovedAnchorReferenceCount(request.referenceImages);
    request.referenceImages.forEach(assertApprovedReferenceImage);
  } catch (cause) {
    throw invalidPresenterVideo('Presenter video generation requires one to three approved local anchor references.', cause);
  }
  partitionSimplePresenterSpeech(request.spokenText, request.maxSeconds);
}

/** Splits simple-path dialogue against the provider coverage selected for the copy. */
export function partitionSimplePresenterSpeech(spokenText: string, maxSeconds: number): readonly string[] {
  const normalized = spokenText.trim().replace(/\s+/g, ' ');
  const words = normalized.split(' ');
  const speechPlanningSeconds = Math.min(maxSeconds, SIMPLE_CLIP_REALIZABLE_MAX_SECONDS);
  if (words.length > Math.floor(speechPlanningSeconds * SIMPLE_PRESENTER_WORDS_PER_SECOND)) {
    throw invalidPresenterVideo('Presenter dialogue exceeds the selected speech-planning capacity.');
  }
  if (speechPlanningSeconds <= INITIAL_VEO_DURATION_SECONDS) {
    return [normalized];
  }
  const extensionCapacity = Math.floor((speechPlanningSeconds - INITIAL_VEO_DURATION_SECONDS) * SIMPLE_PRESENTER_WORDS_PER_SECOND);
  const extensionWords = Math.min(extensionCapacity, words.length - SIMPLE_PRESENTER_CONTINUITY_WORDS);
  if (extensionWords < 1) {
    throw invalidPresenterVideo('Presenter dialogue cannot keep speech active into the initial clip final second and continue into the retained extension.');
  }
  return [words.slice(0, -extensionWords).join(' '), words.slice(-extensionWords).join(' ')];
}

function invalidPresenterVideo(message: string, cause?: unknown): VidGenError {
  return new VidGenError('simple_clip', message, cause === undefined ? {} : { cause });
}
