import { VidGenError } from '../../core/error.ts';
import type {
  ApprovedReferenceImage,
  VideoGenerationClient,
  VideoGenerationRequest,
  VideoGenerationResult,
} from '../../core/generated-media.ts';

export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';
export const VIDGEN_VIDEO_MODEL_ENV = 'VIDGEN_VIDEO_MODEL';
/** Explicit capability declaration for the configured runtime model. */
export const VIDGEN_VIDEO_EXTENSION_ENABLED_ENV = 'VIDGEN_VIDEO_EXTENSION_ENABLED';
export const GOOGLE_VEO_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GOOGLE_VEO_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_GOOGLE_VEO_TOTAL_TIMEOUT_MS = 360_000;
export const DEFAULT_GOOGLE_VEO_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_GOOGLE_VEO_MAX_RESPONSE_BYTES = 1_000_000;
export const DEFAULT_GOOGLE_VEO_MAX_DOWNLOAD_BYTES = 100_000_000;
export const DEFAULT_GOOGLE_VEO_MAX_EXTENSION_COUNT = 3;

const INITIAL_DURATION_SECONDS = 8;
const EXTENSION_DURATION_SECONDS = 7;
const MAX_DOCUMENTED_EXTENSION_COUNT = 20;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_OPERATION_NAME = /^operations\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const APPROVED_REFERENCE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type GoogleVeoEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;

export interface GoogleVeoRuntimeConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly extensionEnabled: boolean;
}

export interface GoogleVeoVideoGenerationClientOptions {
  readonly environment?: GoogleVeoEnvironment;
  readonly fetch?: FetchImplementation;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly totalTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxPollResponseBytes?: number;
  readonly maxDownloadBytes?: number;
  readonly maxExtensionCount?: number;
  readonly maxRedirects?: number;
  /** Test-only/in-process capability override; durable model data never carries it. */
  readonly extensionEnabled?: boolean;
}

/** Loads runtime-only Veo credentials, model selection, and capability declaration. */
export function loadGoogleVeoRuntimeConfig(
  environment: GoogleVeoEnvironment = process.env,
): GoogleVeoRuntimeConfig {
  const model = requiredEnvironmentValue(environment, VIDGEN_VIDEO_MODEL_ENV);
  if (!SAFE_MODEL.test(model)) {
    throw new VidGenError('configuration', 'Google Veo video model configuration is invalid.');
  }
  return {
    apiKey: requiredEnvironmentValue(environment, GEMINI_API_KEY_ENV),
    model,
    extensionEnabled: environment[VIDGEN_VIDEO_EXTENSION_ENABLED_ENV]?.trim().toLowerCase() === 'true',
  };
}

/**
 * Thin Gemini API Veo adapter. It returns only raw provider media and safe
 * provenance; trimming, normalization, and final assembly remain downstream.
 */
export class GoogleVeoVideoGenerationClient implements VideoGenerationClient {
  readonly provider = 'google-veo';
  readonly model: string;

  private readonly apiKey: string;
  private readonly extensionEnabled: boolean;
  private readonly fetchImplementation: FetchImplementation;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly totalTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxPollResponseBytes: number;
  private readonly maxDownloadBytes: number;
  private readonly maxExtensionCount: number;
  private readonly maxRedirects: number;

  constructor(options: GoogleVeoVideoGenerationClientOptions = {}) {
    const config = loadGoogleVeoRuntimeConfig(options.environment);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.extensionEnabled = options.extensionEnabled ?? config.extensionEnabled;
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.pollIntervalMs = positiveSafeInteger(options.pollIntervalMs ?? DEFAULT_GOOGLE_VEO_POLL_INTERVAL_MS, 'Google Veo poll interval must be a positive whole number of milliseconds.');
    this.totalTimeoutMs = positiveSafeInteger(options.totalTimeoutMs ?? DEFAULT_GOOGLE_VEO_TOTAL_TIMEOUT_MS, 'Google Veo total timeout must be a positive whole number of milliseconds.');
    this.requestTimeoutMs = positiveSafeInteger(options.requestTimeoutMs ?? DEFAULT_GOOGLE_VEO_REQUEST_TIMEOUT_MS, 'Google Veo request timeout must be a positive whole number of milliseconds.');
    this.maxPollResponseBytes = positiveSafeInteger(options.maxPollResponseBytes ?? DEFAULT_GOOGLE_VEO_MAX_RESPONSE_BYTES, 'Google Veo maximum operation response size must be a positive whole number of bytes.');
    this.maxDownloadBytes = positiveSafeInteger(options.maxDownloadBytes ?? DEFAULT_GOOGLE_VEO_MAX_DOWNLOAD_BYTES, 'Google Veo maximum download size must be a positive whole number of bytes.');
    this.maxExtensionCount = nonNegativeSafeInteger(options.maxExtensionCount ?? DEFAULT_GOOGLE_VEO_MAX_EXTENSION_COUNT, 'Google Veo maximum extension count must be a non-negative whole number.');
    if (this.maxExtensionCount > MAX_DOCUMENTED_EXTENSION_COUNT) {
      throw new VidGenError('invalid_argument', 'Google Veo maximum extension count exceeds the documented provider limit.');
    }
    this.maxRedirects = nonNegativeSafeInteger(options.maxRedirects ?? 3, 'Google Veo maximum redirect count must be a non-negative whole number.');
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    validateRequest(request);
    const extensionCount = requiredExtensionCount(request.unit.targetDurationSeconds);
    if (extensionCount > 0 && !this.extensionEnabled) {
      throw providerFailure('Google Veo video extension is required but is not enabled for the configured model.');
    }
    if (extensionCount > this.maxExtensionCount) {
      throw providerFailure('Google Veo video request exceeds the configured extension limit.');
    }

    const deadline = this.now() + this.totalTimeoutMs;
    const dialogueChunks = request.unit.role.kind === 'presenter'
      ? partitionPresenterSpeech(request.unit.spokenText, extensionCount + 1)
      : [];
    const operationIds: string[] = [];
    let completed = await this.startAndWait(
      buildInitialRequest(request, dialogueChunks[0]),
      deadline,
    );
    operationIds.push(completed.operationName);
    let downloaded = await this.downloadVideo(completed.downloadUri);

    for (let extensionIndex = 0; extensionIndex < extensionCount; extensionIndex += 1) {
      if (downloaded.bytes.byteLength > this.maxDownloadBytes) {
        throw providerFailure('Google Veo extension input exceeded the maximum supported size.');
      }
      completed = await this.startAndWait(
        buildExtensionRequest(request, downloaded, dialogueChunks[extensionIndex + 1]),
        deadline,
      );
      operationIds.push(completed.operationName);
      downloaded = await this.downloadVideo(completed.downloadUri);
    }

    const durationSeconds = INITIAL_DURATION_SECONDS + (extensionCount * EXTENSION_DURATION_SECONDS);
    return {
      provider: this.provider,
      model: completed.model ?? this.model,
      requestId: operationIds[0],
      operationId: operationIds.at(-1),
      operationIds,
      generationOperationCount: operationIds.length,
      mimeType: downloaded.mimeType,
      bytes: downloaded.bytes,
      durationSeconds,
    };
  }

  private async startAndWait(body: Record<string, unknown>, deadline: number): Promise<CompletedOperation> {
    this.assertBeforeDeadline(deadline);
    const startPayload = await this.requestJson(
      `${GOOGLE_VEO_API_BASE}/models/${this.model}:predictLongRunning`,
      { method: 'POST', headers: this.apiHeaders(true), body: JSON.stringify(body), redirect: 'error' },
    );
    this.assertBeforeDeadline(deadline);
    const operationName = operationNameFrom(startPayload);
    let operation = startPayload;
    let pollCount = 0;
    while (!operationIsDone(operation)) {
      this.assertBeforeDeadline(deadline);
      if (pollCount >= Math.ceil(this.totalTimeoutMs / this.pollIntervalMs)) {
        throw providerFailure('Google Veo video generation timed out.');
      }
      try {
        await this.sleep(this.pollIntervalMs);
      } catch (cause) {
        throw providerFailure('Google Veo video generation polling failed.', cause);
      }
      this.assertBeforeDeadline(deadline);
      operation = await this.requestJson(
        `${GOOGLE_VEO_API_BASE}/${operationName}`,
        { method: 'GET', headers: this.apiHeaders(false), redirect: 'error' },
      );
      pollCount += 1;
    }
    return completedOperation(operation, operationName);
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, init);
    } catch (cause) {
      if (cause instanceof VidGenError) {
        throw cause;
      }
      throw providerFailure('Unable to reach the Google Veo video service.', cause);
    }
    if (!response.ok) {
      throw providerFailure('Google Veo video service returned an unsuccessful response.');
    }
    return parseBoundedJson(response, this.maxPollResponseBytes);
  }

  private async downloadVideo(initialUri: string): Promise<DownloadedVideo> {
    let uri = validateGoogleDownloadUri(initialUri);
    for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(uri.toString(), {
          method: 'GET', headers: this.apiHeaders(false), redirect: 'manual',
        });
      } catch (cause) {
        if (cause instanceof VidGenError) {
          throw cause;
        }
        throw providerFailure('Unable to download Google Veo generated video.', cause);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null || redirects === this.maxRedirects) {
          throw providerFailure('Google Veo generated video download redirect was unsafe or incomplete.');
        }
        try {
          uri = validateGoogleDownloadUri(new URL(location, uri).toString());
        } catch (cause) {
          if (cause instanceof VidGenError) {
            throw cause;
          }
          throw providerFailure('Google Veo generated video download redirect was unsafe or incomplete.', cause);
        }
        continue;
      }
      if (!response.ok) {
        throw providerFailure('Google Veo generated video download returned an unsuccessful response.');
      }
      const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mimeType === undefined || !mimeType.startsWith('video/')) {
        throw providerFailure('Google Veo generated video download had an invalid media type.');
      }
      const bytes = await readBoundedBytes(response, this.maxDownloadBytes, 'Google Veo generated video download exceeded the maximum supported size.');
      if (bytes.byteLength === 0) {
        throw providerFailure('Google Veo generated video download was empty.');
      }
      if (!hasRecognizedVideoSignature(mimeType, bytes)) {
        throw providerFailure('Google Veo generated video download had an invalid video body.');
      }
      return { mimeType, bytes };
    }
    throw providerFailure('Google Veo generated video download redirect was unsafe or incomplete.');
  }

  private apiHeaders(includeContentType: boolean): HeadersInit {
    return includeContentType
      ? { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }
      : { 'x-goog-api-key': this.apiKey };
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImplementation(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw providerFailure('Google Veo video request timed out.', cause);
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertBeforeDeadline(deadline: number): void {
    if (this.now() >= deadline) {
      throw providerFailure('Google Veo video generation timed out.');
    }
  }
}

/** Splits validated presenter dialogue without ever rewriting its words. */
export function partitionPresenterSpeech(spokenText: string, chunkCount: number): readonly string[] {
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) {
    throw new VidGenError('invalid_argument', 'Presenter dialogue chunk count must be a positive whole number.');
  }
  const normalized = spokenText.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new VidGenError('generated_media', 'A presenter video generation request requires spoken text.');
  }
  const words = normalized.split(' ');
  const weights = Array.from({ length: chunkCount }, (_unused, index) =>
    index === 0 ? INITIAL_DURATION_SECONDS : EXTENSION_DURATION_SECONDS,
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const chunks: string[] = [];
  let cursor = 0;
  let priorTarget = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const target = index === chunkCount - 1
      ? words.length
      : Math.floor((words.length * weights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0)) / totalWeight);
    const count = Math.max(0, target - priorTarget);
    chunks.push(words.slice(cursor, cursor + count).join(' '));
    cursor += count;
    priorTarget = target;
  }
  return chunks;
}

function buildInitialRequest(
  request: VideoGenerationRequest,
  dialogue: string | undefined,
): Record<string, unknown> {
  const instance: Record<string, unknown> = {
    prompt: request.unit.role.kind === 'presenter'
      ? presenterPrompt(request, dialogue ?? request.unit.spokenText, false)
      : contentPrompt(request, false),
  };
  if (request.unit.role.kind === 'presenter') {
    instance.referenceImages = request.referenceImages?.map(toReferenceImage);
  }
  return {
    instances: [instance],
    parameters: {
      aspectRatio: '9:16', durationSeconds: String(INITIAL_DURATION_SECONDS), numberOfVideos: 1, resolution: '720p',
    },
  };
}

function buildExtensionRequest(
  request: VideoGenerationRequest,
  previous: DownloadedVideo,
  dialogue: string | undefined,
): Record<string, unknown> {
  return {
    instances: [{
      prompt: request.unit.role.kind === 'presenter'
        ? presenterPrompt(request, dialogue ?? '', true)
        : contentPrompt(request, true),
      video: { inlineData: { mimeType: previous.mimeType, data: Buffer.from(previous.bytes).toString('base64') } },
    }],
    parameters: { aspectRatio: '9:16', numberOfVideos: 1, resolution: '720p' },
  };
}

function presenterPrompt(request: VideoGenerationRequest, dialogue: string, isExtension: boolean): string {
  const context = unitContext(request);
  const continuity = isExtension
    ? 'Continue the same presenter, appearance, setting, and scene continuity from the supplied prior Veo video.'
    : 'Preserve the intended anchor appearance from the supplied reference images.';
  return [
    'Create a portrait news-presenter video.', continuity,
    `Use only this supplied ClipPlan visual/news context: ${context}.`,
    `The presenter must speak only this exact assigned dialogue: "${dialogue}".`,
    'Do not add dialogue. Do not create readable or generated on-screen text. Do not add unsupported story facts.',
  ].join(' ');
}

function contentPrompt(request: VideoGenerationRequest, isExtension: boolean): string {
  const continuity = isExtension
    ? 'Continue the same supplied visual treatment from the prior Veo video.'
    : 'Create a portrait news B-roll video.';
  return [
    continuity,
    `Remain grounded only in this supplied ClipPlan content: ${unitContext(request)}.`,
    'Do not introduce new specific story claims. Do not add dialogue or voice narration.',
    'Do not create readable or generated on-screen text. Do not retrieve or reuse publisher media.',
  ].join(' ');
}

function unitContext(request: VideoGenerationRequest): string {
  return request.unit.content.map((value) => `${value.usage} ${value.slotId}: ${value.text}`).join(' | ');
}

function toReferenceImage(image: ApprovedReferenceImage): Record<string, unknown> {
  return {
    image: { inlineData: { mimeType: image.mimeType, data: Buffer.from(image.bytes).toString('base64') } },
    referenceType: 'asset',
  };
}

function validateRequest(request: VideoGenerationRequest): void {
  if (request === null || typeof request !== 'object' || request.unit === undefined) {
    throw new VidGenError('invalid_argument', 'Google Veo video generation request is invalid.');
  }
  if (!Number.isFinite(request.unit.targetDurationSeconds) || request.unit.targetDurationSeconds <= 0) {
    throw new VidGenError('generated_media', 'Google Veo video generation requires a positive target duration.');
  }
  if (request.unit.role.kind !== 'presenter' && request.unit.role.kind !== 'video') {
    throw new VidGenError('generated_media', 'Google Veo supports presenter and video generated-media units only.');
  }
  if (request.unit.content.length === 0) {
    throw new VidGenError('generated_media', 'Google Veo video generation requires resolved unit content.');
  }
  if (request.unit.role.kind === 'presenter') {
    if (request.referenceImages === undefined || request.referenceImages.length === 0) {
      throw new VidGenError('generated_media', 'Google Veo presenter generation requires one to three approved reference images.');
    }
    if (request.referenceImages.length > 3) {
      throw new VidGenError('generated_media', 'Google Veo presenter generation supports at most three approved reference images.');
    }
    if (request.unit.spokenText.trim().length === 0) {
      throw new VidGenError('generated_media', 'Google Veo presenter generation requires spoken text.');
    }
    for (const image of request.referenceImages) {
      if (!APPROVED_REFERENCE_IMAGE_MIME_TYPES.has(image.mimeType) || image.bytes.byteLength === 0) {
        throw new VidGenError('generated_media', 'Google Veo presenter generation received an unsupported approved reference image.');
      }
    }
  } else if (request.referenceImages !== undefined && request.referenceImages.length > 0) {
    throw new VidGenError('generated_media', 'Google Veo video generation does not accept presenter reference images.');
  }
}

function requiredExtensionCount(targetDurationSeconds: number): number {
  return Math.max(0, Math.ceil((targetDurationSeconds - INITIAL_DURATION_SECONDS) / EXTENSION_DURATION_SECONDS));
}

function operationNameFrom(payload: unknown): string {
  const operation = asRecord(payload);
  const name = operation === undefined ? undefined : nonBlankString(operation.name);
  if (name === undefined || !SAFE_OPERATION_NAME.test(name)) {
    throw providerFailure('Google Veo video service returned an invalid operation identifier.');
  }
  return name;
}

function operationIsDone(payload: unknown): boolean {
  const operation = asRecord(payload);
  if (operation === undefined || typeof operation.done !== 'boolean') {
    throw providerFailure('Google Veo video service returned a malformed operation.');
  }
  if (operation.error !== undefined) {
    throw providerFailure('Google Veo video generation failed.');
  }
  return operation.done;
}

function completedOperation(payload: unknown, operationName: string): CompletedOperation {
  const operation = asRecord(payload);
  if (operation === undefined || operation.error !== undefined) {
    throw providerFailure('Google Veo video generation failed.');
  }
  const response = asRecord(operation.response);
  const generation = response === undefined ? undefined : asRecord(response.generateVideoResponse);
  const samples = generation === undefined ? undefined : generation.generatedSamples;
  const sample = Array.isArray(samples) && samples.length === 1 ? asRecord(samples[0]) : undefined;
  const video = sample === undefined ? undefined : asRecord(sample.video);
  const downloadUri = video === undefined ? undefined : nonBlankString(video.uri);
  if (downloadUri === undefined) {
    throw providerFailure('Google Veo video generation completed without a video result.');
  }
  const returnedModel = nonBlankString(operation.model) ?? nonBlankString(response?.model);
  const model = returnedModel !== undefined && SAFE_MODEL.test(returnedModel) ? returnedModel : undefined;
  return { operationName, downloadUri, model };
}

function validateGoogleDownloadUri(value: string): URL {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch (cause) {
    throw providerFailure('Google Veo generated video download URI was unsafe.', cause);
  }
  const host = uri.hostname.toLowerCase();
  if (uri.protocol !== 'https:' || uri.username.length > 0 || uri.password.length > 0 || !isAllowedGoogleApiHost(host)) {
    throw providerFailure('Google Veo generated video download URI was unsafe.');
  }
  return uri;
}

function isAllowedGoogleApiHost(host: string): boolean {
  return host === 'generativelanguage.googleapis.com'
    || host === 'storage.googleapis.com';
}

function hasRecognizedVideoSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'video/mp4') {
    return bytes.byteLength >= 8
      && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  }
  if (mimeType === 'video/webm') {
    return bytes.byteLength >= 4
      && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  return true;
}

async function parseBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(response, maxBytes, 'Google Veo operation response exceeded the maximum supported size.');
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (cause) {
    throw providerFailure('Google Veo video service returned invalid JSON.', cause);
  }
}

async function readBoundedBytes(response: Response, maxBytes: number, oversizedMessage: string): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw providerFailure(oversizedMessage);
  }
  if (response.body === null) {
    throw providerFailure('Google Veo video service returned an unreadable response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw providerFailure(oversizedMessage);
      }
      chunks.push(chunk.value);
    }
  } catch (cause) {
    if (cause instanceof VidGenError) {
      throw cause;
    }
    throw providerFailure('Google Veo video service returned an unreadable response.', cause);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requiredEnvironmentValue(environment: GoogleVeoEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new VidGenError('configuration', `Google Veo ${name} configuration is required.`);
  }
  return value;
}

function positiveSafeInteger(value: number, publicMessage: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new VidGenError('invalid_argument', publicMessage);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, publicMessage: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VidGenError('invalid_argument', publicMessage);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function providerFailure(publicMessage: string, cause?: unknown): VidGenError {
  return new VidGenError('generated_media', publicMessage, cause === undefined ? {} : { cause });
}

interface CompletedOperation {
  readonly operationName: string;
  readonly downloadUri: string;
  readonly model?: string;
}

interface DownloadedVideo {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}
