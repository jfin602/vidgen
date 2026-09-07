import { assertApprovedAnchorReferenceCount, assertApprovedReferenceImage, type ApprovedReferenceImage } from './anchor-reference.ts';
import { VidGenError } from './error.ts';
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
  /** The Phase 6 final-artifact ceiling, not a raw provider-duration claim. */
  readonly finalDurationCeilingSeconds: number;
  /** Coverage requested from the current provider before deterministic finishing. */
  readonly rawProviderDurationSeconds: number;
  readonly extensionCount: 0 | 1;
  readonly requiresFinalTrim: boolean;
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
  /** Raw provider coverage; it can exceed the eventual final clip ceiling. */
  readonly rawDurationSeconds: number;
  readonly durationPlan: PresenterVideoDurationPlan;
}

/** A narrow simple-path boundary; it never accepts cinematic media units. */
export interface PresenterVideoGenerationClient {
  readonly provider: string;
  readonly model: string;
  generatePresenterVideo(request: PresenterVideoGenerationRequest): Promise<PresenterVideoGenerationResult>;
}

/**
 * Current Veo reference-image coverage: an 8-second initial video, with one
 * 7-second extension where useful. Short ceilings are trimmed in the later
 * finishing step; 16-20 second ceilings remain ceilings rather than targets.
 */
export function planPresenterVideoDuration(maxSeconds: number): PresenterVideoDurationPlan {
  assertSimpleClipMaxSeconds(maxSeconds);
  const extensionCount: 0 | 1 = maxSeconds <= INITIAL_VEO_DURATION_SECONDS ? 0 : 1;
  const rawProviderDurationSeconds = INITIAL_VEO_DURATION_SECONDS + (extensionCount * VEO_EXTENSION_DURATION_SECONDS);
  return {
    finalDurationCeilingSeconds: maxSeconds,
    rawProviderDurationSeconds,
    extensionCount,
    requiresFinalTrim: rawProviderDurationSeconds > maxSeconds,
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

/** Splits simple-path dialogue against the final retained Veo timeline. */
export function partitionSimplePresenterSpeech(spokenText: string, maxSeconds: number): readonly string[] {
  const normalized = spokenText.trim().replace(/\s+/g, ' ');
  const words = normalized.split(' ');
  const finalDurationSeconds = Math.min(maxSeconds, SIMPLE_CLIP_REALIZABLE_MAX_SECONDS);
  if (words.length > Math.floor(finalDurationSeconds * SIMPLE_PRESENTER_WORDS_PER_SECOND)) {
    throw invalidPresenterVideo('Presenter dialogue exceeds the selected final-duration speech capacity.');
  }
  if (finalDurationSeconds <= INITIAL_VEO_DURATION_SECONDS) {
    return [normalized];
  }
  const extensionCapacity = Math.floor((finalDurationSeconds - INITIAL_VEO_DURATION_SECONDS) * SIMPLE_PRESENTER_WORDS_PER_SECOND);
  const extensionWords = Math.min(extensionCapacity, words.length - SIMPLE_PRESENTER_CONTINUITY_WORDS);
  if (extensionWords < 1) {
    throw invalidPresenterVideo('Presenter dialogue cannot keep speech active into the initial clip final second and continue into the retained extension.');
  }
  return [words.slice(0, -extensionWords).join(' '), words.slice(-extensionWords).join(' ')];
}

function invalidPresenterVideo(message: string, cause?: unknown): VidGenError {
  return new VidGenError('simple_clip', message, cause === undefined ? {} : { cause });
}
