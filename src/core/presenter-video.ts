import { assertApprovedAnchorReferenceCount, assertApprovedReferenceImage, type ApprovedReferenceImage } from './anchor-reference.ts';
import { VidGenError } from './error.ts';
import { assertSimpleClipMaxSeconds } from './simple-clip-copy.ts';

const INITIAL_VEO_DURATION_SECONDS = 8;
const VEO_EXTENSION_DURATION_SECONDS = 7;

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
}

function invalidPresenterVideo(message: string, cause?: unknown): VidGenError {
  return new VidGenError('simple_clip', message, cause === undefined ? {} : { cause });
}
