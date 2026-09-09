import { sanitizeProviderDiagnostic, VidGenError } from '../../core/error.ts';
import { defaultGoogleCloudAccessToken, type GoogleCloudAccessTokenProvider } from './google-cloud-auth.ts';
import type { ApprovedReferenceImage, VideoGenerationClient, VideoGenerationRequest, VideoGenerationResult } from '../../core/generated-media.ts';
import { loadVeoPromptSpec, renderVeoPrompt, type LoadedVeoPromptSpec } from './veo-prompt-spec.ts';
import {
  assertPresenterVideoGenerationRequest,
  partitionSimplePresenterSpeech,
  planPresenterVideoDuration,
  type PresenterVideoGenerationClient,
  type PresenterVideoGenerationRequest,
  type PresenterVideoGenerationResult,
} from '../../core/presenter-video.ts';

export const GOOGLE_CLOUD_PROJECT_ENV = 'GOOGLE_CLOUD_PROJECT';
export const GOOGLE_CLOUD_LOCATION_ENV = 'GOOGLE_CLOUD_LOCATION';
export const VIDGEN_VIDEO_MODEL_ENV = 'VIDGEN_VIDEO_MODEL';
export const GOOGLE_AGENT_PLATFORM_VEO_LOCATION = 'us-central1';
export const GOOGLE_AGENT_PLATFORM_VEO_API_BASE = `https://${GOOGLE_AGENT_PLATFORM_VEO_LOCATION}-aiplatform.googleapis.com/v1`;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_TOTAL_TIMEOUT_MS = 360_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_AUTH_TIMEOUT_MS = 30_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_RESPONSE_BYTES = 140_000_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_VIDEO_BYTES = 100_000_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_EXTENSION_COUNT = 3;

const INITIAL_DURATION_SECONDS = 8;
const EXTENSION_DURATION_SECONDS = 7;
const BASE64_DECODE_CHUNK_LENGTH = 1024 * 1024;
const SUPPORTED_MODELS = new Set(['veo-3.1-generate-001', 'veo-3.1-fast-generate-001']);
const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const SAFE_ACCESS_TOKEN = /^[A-Za-z0-9._~-]{1,16384}$/;

export type GoogleAgentPlatformVeoEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;
export type GoogleAgentPlatformAccessTokenProvider = GoogleCloudAccessTokenProvider;
export interface GoogleAgentPlatformVeoProgressEvent { readonly stage: 'operation_started' | 'operation_pending' | 'operation_completed'; readonly operationNumber: number; readonly pollNumber?: number; }

export interface GoogleAgentPlatformVeoRuntimeConfig {
  readonly project: string;
  readonly location: typeof GOOGLE_AGENT_PLATFORM_VEO_LOCATION;
  readonly model: string;
}

export interface GoogleAgentPlatformVeoVideoGenerationClientOptions {
  readonly environment?: GoogleAgentPlatformVeoEnvironment;
  readonly fetch?: FetchImplementation;
  /** Injectable so tests never need ambient ADC. */
  readonly getAccessToken?: GoogleAgentPlatformAccessTokenProvider;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly totalTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly authTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxVideoBytes?: number;
  readonly maxExtensionCount?: number;
  readonly onProgress?: (event: GoogleAgentPlatformVeoProgressEvent) => void;
}

/** Loads only Agent Platform runtime identity; Developer API credentials are never read here. */
export function loadGoogleAgentPlatformVeoRuntimeConfig(environment: GoogleAgentPlatformVeoEnvironment = process.env): GoogleAgentPlatformVeoRuntimeConfig {
  const project = requiredEnvironmentValue(environment, GOOGLE_CLOUD_PROJECT_ENV);
  const location = requiredEnvironmentValue(environment, GOOGLE_CLOUD_LOCATION_ENV);
  const model = requiredEnvironmentValue(environment, VIDGEN_VIDEO_MODEL_ENV);
  if (!SAFE_PROJECT.test(project) || location !== GOOGLE_AGENT_PLATFORM_VEO_LOCATION || !SUPPORTED_MODELS.has(model)) {
    throw new VidGenError('configuration', 'Agent Platform Veo project, location, or model configuration is invalid.');
  }
  return { project, location: GOOGLE_AGENT_PLATFORM_VEO_LOCATION, model };
}

/** Agent Platform REST Veo adapter. It exposes only neutral raw media and safe operation provenance. */
export class GoogleAgentPlatformVeoVideoGenerationClient implements VideoGenerationClient, PresenterVideoGenerationClient {
  readonly provider = 'google-agent-platform-veo';
  readonly model: string;
  readonly promptAssetIdentity;

  private readonly project: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly getAccessToken: GoogleAgentPlatformAccessTokenProvider;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly totalTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly authTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxVideoBytes: number;
  private readonly maxExtensionCount: number;
  private readonly prompts: LoadedVeoPromptSpec;
  private readonly onProgress?: (event: GoogleAgentPlatformVeoProgressEvent) => void;

  constructor(options: GoogleAgentPlatformVeoVideoGenerationClientOptions = {}) {
    const config = loadGoogleAgentPlatformVeoRuntimeConfig(options.environment);
    this.project = config.project;
    this.model = config.model;
    this.prompts = loadVeoPromptSpec(options.environment);
    this.promptAssetIdentity = this.prompts.identity;
    this.fetchImplementation = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken ?? defaultGoogleCloudAccessToken;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.pollIntervalMs = positiveSafeInteger(options.pollIntervalMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_POLL_INTERVAL_MS, 'Agent Platform Veo poll interval must be a positive whole number of milliseconds.');
    this.totalTimeoutMs = positiveSafeInteger(options.totalTimeoutMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_TOTAL_TIMEOUT_MS, 'Agent Platform Veo total timeout must be a positive whole number of milliseconds.');
    this.requestTimeoutMs = positiveSafeInteger(options.requestTimeoutMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_REQUEST_TIMEOUT_MS, 'Agent Platform Veo request timeout must be a positive whole number of milliseconds.');
    this.authTimeoutMs = positiveSafeInteger(options.authTimeoutMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_AUTH_TIMEOUT_MS, 'Agent Platform Veo authentication timeout must be a positive whole number of milliseconds.');
    this.maxResponseBytes = positiveSafeInteger(options.maxResponseBytes ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_RESPONSE_BYTES, 'Agent Platform Veo maximum operation response size must be a positive whole number of bytes.');
    this.maxVideoBytes = positiveSafeInteger(options.maxVideoBytes ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_VIDEO_BYTES, 'Agent Platform Veo maximum video size must be a positive whole number of bytes.');
    this.maxExtensionCount = nonNegativeSafeInteger(options.maxExtensionCount ?? DEFAULT_GOOGLE_AGENT_PLATFORM_VEO_MAX_EXTENSION_COUNT, 'Agent Platform Veo maximum extension count must be a non-negative whole number.');
    this.onProgress = options.onProgress;
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    return this.withRuntimeClassification(async (stage) => {
      validateVideoRequest(request);
      const extensionCount = requiredExtensionCount(request.unit.targetDurationSeconds);
      this.assertExtensionCount(extensionCount);
      const dialogue = request.unit.role.kind === 'presenter' ? partitionCinematicSpeech(request.unit.spokenText, extensionCount + 1) : [];
      const generated = await this.generateSequence(
        buildInitialRequest(request, dialogue[0], this.prompts), extensionCount,
        (previous, index) => buildExtensionRequest(request, previous, dialogue[index + 1], this.prompts), stage,
      );
      stage.value = 'result_decode';
      return resultFor(this, generated, INITIAL_DURATION_SECONDS + (extensionCount * EXTENSION_DURATION_SECONDS));
    });
  }

  async generatePresenterVideo(request: PresenterVideoGenerationRequest): Promise<PresenterVideoGenerationResult> {
    return this.withRuntimeClassification(async (stage) => {
      assertPresenterVideoGenerationRequest(request);
      assertAgentPlatformReferences(request.referenceImages);
      const durationPlan = planPresenterVideoDuration(request.maxSeconds);
      this.assertExtensionCount(durationPlan.extensionCount);
      const dialogue = partitionSimplePresenterSpeech(request.spokenText, request.maxSeconds);
      const retainedExtensionSeconds = Math.min(request.maxSeconds, durationPlan.rawProviderDurationSeconds) - INITIAL_DURATION_SECONDS;
      const generated = await this.generateSequence(
        buildSimpleInitialRequest(request, dialogue[0]!, durationPlan.extensionCount > 0, this.prompts), durationPlan.extensionCount,
        (previous, index) => buildSimpleExtensionRequest(previous, dialogue[index + 1] ?? '', retainedExtensionSeconds, this.prompts), stage,
      );
      stage.value = 'result_decode';
      return { ...resultFor(this, generated), rawDurationSeconds: durationPlan.rawProviderDurationSeconds, durationPlan };
    });
  }

  private assertExtensionCount(count: number): void {
    if (count > this.maxExtensionCount) throw providerFailure('Agent Platform Veo video request exceeds the configured extension limit.');
  }

  private async generateSequence(
    initialBody: Record<string, unknown>,
    extensionCount: number,
    extensionBody: (previous: InlineVideo, extensionIndex: number) => Record<string, unknown>,
    stage: VeoStageTracker,
  ): Promise<GeneratedSequence> {
    stage.value = 'auth';
    const token = await this.accessToken();
    const deadline = this.now() + this.totalTimeoutMs;
    const operationIds: string[] = [];
    let completed = await this.startAndWait(initialBody, token, deadline, 1, stage);
    operationIds.push(completed.operationName);
    let video = completed.video;
    for (let index = 0; index < extensionCount; index += 1) {
      stage.value = 'start_request';
      completed = await this.startAndWait(extensionBody(video, index), token, deadline, index + 2, stage);
      operationIds.push(completed.operationName);
      video = completed.video;
    }
    return { operationIds, video };
  }

  private async accessToken(): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const token = await Promise.race([
        this.getAccessToken(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.authTimeoutMs); }),
      ]);
      if (typeof token !== 'string' || !SAFE_ACCESS_TOKEN.test(token)) throw new Error('invalid token');
      return token;
    } catch (cause) {
      if (cause instanceof VidGenError) throw cause;
      throw runtimeFailure('auth', cause);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private async startAndWait(body: Record<string, unknown>, token: string, deadline: number, operationNumber: number, stage: VeoStageTracker): Promise<CompletedOperation> {
    this.assertBeforeDeadline(deadline);
    stage.value = 'start_request';
    const started = await this.requestJson(this.modelUrl(':predictLongRunning'), body, token, 'start_request');
    stage.value = 'operation_parse';
    const operationName = this.operationNameFrom(started);
    this.progress({ stage: 'operation_started', operationNumber });
    let operation = started;
    let polls = 0;
    while (true) {
      stage.value = 'operation_parse';
      if (operationDone(operation)) break;
      this.assertBeforeDeadline(deadline);
      if (polls >= Math.ceil(this.totalTimeoutMs / this.pollIntervalMs)) throw providerFailure('Agent Platform Veo video generation timed out.');
      stage.value = 'poll_request';
      await this.sleep(this.pollIntervalMs);
      this.assertBeforeDeadline(deadline);
      stage.value = 'poll_request';
      operation = await this.requestJson(this.modelUrl(':fetchPredictOperation'), { operationName }, token, 'poll_request');
      polls += 1;
      stage.value = 'operation_parse';
      if (!operationDone(operation)) this.progress({ stage: 'operation_pending', operationNumber, pollNumber: polls });
    }
    stage.value = 'operation_parse';
    const completed = completedOperation(operation, operationName, this.maxVideoBytes, () => { stage.value = 'result_decode'; });
    this.progress({ stage: 'operation_completed', operationNumber });
    return completed;
  }

  private async requestJson(url: string, body: Record<string, unknown>, token: string, requestStage: 'start_request' | 'poll_request'): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' });
    } catch (cause) {
      if (cause instanceof VidGenError) throw cause;
      throw runtimeFailure(requestStage, cause);
    }
    try {
      if (!response.ok) throw providerFailure('Agent Platform Veo video service returned an unsuccessful response.');
      return await parseBoundedJson(response, this.maxResponseBytes);
    } catch (cause) {
      if (cause instanceof VidGenError) throw cause;
      throw runtimeFailure('operation_parse', cause);
    }
  }

  private modelUrl(suffix: ':predictLongRunning' | ':fetchPredictOperation'): string {
    return `${GOOGLE_AGENT_PLATFORM_VEO_API_BASE}/projects/${this.project}/locations/${GOOGLE_AGENT_PLATFORM_VEO_LOCATION}/publishers/google/models/${this.model}${suffix}`;
  }

  private operationNameFrom(payload: unknown): string {
    const name = record(payload)?.name;
    const expected = `projects/${this.project}/locations/${GOOGLE_AGENT_PLATFORM_VEO_LOCATION}/publishers/google/models/${this.model}/operations/`;
    if (typeof name !== 'string' || !name.startsWith(expected) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(name.slice(expected.length))) {
      throw providerFailure('Agent Platform Veo video service returned an invalid operation identifier.');
    }
    return name;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try { return await this.fetchImplementation(url, { ...init, signal: controller.signal }); }
    catch (cause) { if (controller.signal.aborted) throw providerFailure('Agent Platform Veo video request timed out.', cause); throw cause; }
    finally { clearTimeout(timeout); }
  }

  private assertBeforeDeadline(deadline: number): void { if (this.now() >= deadline) throw providerFailure('Agent Platform Veo video generation timed out.'); }
  private progress(event: GoogleAgentPlatformVeoProgressEvent): void { try { this.onProgress?.(event); } catch {} }

  private async withRuntimeClassification<T>(work: (stage: VeoStageTracker) => Promise<T>): Promise<T> {
    const stage: VeoStageTracker = { value: 'start_request' };
    try { return await work(stage); } catch (cause) { throw runtimeFailure(stage.value, cause); }
  }
}

function resultFor(client: GoogleAgentPlatformVeoVideoGenerationClient, generated: GeneratedSequence, durationSeconds?: number): VideoGenerationResult {
  return { provider: client.provider, model: client.model, requestId: generated.operationIds[0], operationId: generated.operationIds.at(-1), operationIds: generated.operationIds, generationOperationCount: generated.operationIds.length, mimeType: generated.video.mimeType, bytes: generated.video.bytes, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

function buildInitialRequest(request: VideoGenerationRequest, dialogue: string | undefined, prompts: LoadedVeoPromptSpec): Record<string, unknown> {
  const instance: Record<string, unknown> = { prompt: request.unit.role.kind === 'presenter' ? cinematicPrompt(request, dialogue ?? request.unit.spokenText, false, prompts) : cinematicPrompt(request, undefined, false, prompts) };
  if (request.unit.role.kind === 'presenter') instance.referenceImages = request.referenceImages!.map(toAssetReference);
  return { instances: [instance], parameters: videoParameters(true) };
}

function buildExtensionRequest(request: VideoGenerationRequest, previous: InlineVideo, dialogue: string | undefined, prompts: LoadedVeoPromptSpec): Record<string, unknown> {
  return { instances: [{ prompt: request.unit.role.kind === 'presenter' ? cinematicPrompt(request, dialogue ?? '', true, prompts) : cinematicPrompt(request, undefined, true, prompts), video: toInlineVideo(previous) }], parameters: videoParameters(false) };
}

function buildSimpleInitialRequest(request: PresenterVideoGenerationRequest, dialogue: string, requiresExtension: boolean, prompts: LoadedVeoPromptSpec): Record<string, unknown> {
  return { instances: [{ prompt: renderVeoPrompt(requiresExtension ? 'simplePresenterInitialWithExtension' : 'simplePresenterInitial', prompts.templates[requiresExtension ? 'simplePresenterInitialWithExtension' : 'simplePresenterInitial'], { dialogue, context: '', retainedExtensionSeconds: '' }), referenceImages: request.referenceImages.map(toAssetReference) }], parameters: videoParameters(true) };
}

function buildSimpleExtensionRequest(previous: InlineVideo, dialogue: string, retainedExtensionSeconds: number, prompts: LoadedVeoPromptSpec): Record<string, unknown> {
  return { instances: [{ prompt: renderVeoPrompt('simplePresenterExtension', prompts.templates.simplePresenterExtension, { dialogue, context: '', retainedExtensionSeconds: String(retainedExtensionSeconds) }), video: toInlineVideo(previous) }], parameters: videoParameters(false) };
}

function videoParameters(initial: boolean): Record<string, unknown> {
  return { aspectRatio: '9:16', ...(initial ? { durationSeconds: INITIAL_DURATION_SECONDS } : {}), resolution: '720p', sampleCount: 1 };
}

function cinematicPrompt(request: VideoGenerationRequest, dialogue: string | undefined, extension: boolean, prompts: LoadedVeoPromptSpec): string {
  const name = request.unit.role.kind === 'presenter'
    ? (extension ? 'cinematicPresenterExtension' : 'cinematicPresenterInitial')
    : (extension ? 'cinematicContentExtension' : 'cinematicContentInitial');
  return renderVeoPrompt(name, prompts.templates[name], { dialogue: dialogue ?? '', context: unitContext(request), retainedExtensionSeconds: '' });
}

function unitContext(request: VideoGenerationRequest): string { return request.unit.content.map((value) => `${value.usage} ${value.slotId}: ${value.text}`).join(' | '); }
function toAssetReference(image: ApprovedReferenceImage): Record<string, unknown> { return { image: { bytesBase64Encoded: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType }, referenceType: 'asset' }; }
function toInlineVideo(video: InlineVideo): Record<string, unknown> { return { bytesBase64Encoded: Buffer.from(video.bytes).toString('base64'), mimeType: video.mimeType }; }

function validateVideoRequest(request: VideoGenerationRequest): void {
  if (request === null || typeof request !== 'object' || request.unit === undefined) throw new VidGenError('invalid_argument', 'Agent Platform Veo video generation request is invalid.');
  if (!Number.isFinite(request.unit.targetDurationSeconds) || request.unit.targetDurationSeconds <= 0 || !['presenter', 'video'].includes(request.unit.role.kind) || request.unit.content.length === 0) throw new VidGenError('generated_media', 'Agent Platform Veo video generation request is invalid.');
  if (request.unit.role.kind === 'presenter') {
    if (request.referenceImages === undefined || request.unit.spokenText.trim().length === 0) throw new VidGenError('generated_media', 'Agent Platform Veo presenter generation requires approved reference images and spoken text.');
    assertAgentPlatformReferences(request.referenceImages);
  } else if (request.referenceImages !== undefined && request.referenceImages.length > 0) throw new VidGenError('generated_media', 'Agent Platform Veo video generation does not accept presenter reference images.');
}

function assertAgentPlatformReferences(references: readonly ApprovedReferenceImage[]): void {
  if (references.length < 1 || references.length > 3 || references.some((image) => !['image/png', 'image/jpeg'].includes(image.mimeType) || image.bytes.byteLength < 1)) throw new VidGenError('generated_media', 'Agent Platform Veo presenter generation requires one to three PNG or JPEG approved reference images.');
}

function partitionCinematicSpeech(text: string, chunks: number): readonly string[] {
  const normalized = text.trim().replace(/\s+/g, ' '); if (normalized.length === 0) throw new VidGenError('generated_media', 'Agent Platform Veo presenter generation requires spoken text.');
  const words = normalized.split(' '); const weight = INITIAL_DURATION_SECONDS + ((chunks - 1) * EXTENSION_DURATION_SECONDS); const result: string[] = []; let cursor = 0; let covered = 0;
  for (let index = 0; index < chunks; index += 1) { covered += index === 0 ? INITIAL_DURATION_SECONDS : EXTENSION_DURATION_SECONDS; const end = index === chunks - 1 ? words.length : Math.floor((words.length * covered) / weight); result.push(words.slice(cursor, end).join(' ')); cursor = end; }
  return result;
}

function requiredExtensionCount(seconds: number): number { return Math.max(0, Math.ceil((seconds - INITIAL_DURATION_SECONDS) / EXTENSION_DURATION_SECONDS)); }
function operationDone(payload: unknown): boolean { const operation = record(payload); if (operation === undefined || (operation.done !== undefined && typeof operation.done !== 'boolean')) throw providerFailure('Agent Platform Veo video service returned a malformed operation.'); if (operation.error !== undefined) throw providerFailure('Agent Platform Veo video generation failed.', undefined, operationDiagnostic(operation)); return operation.done === true; }

function completedOperation(payload: unknown, operationName: string, maxVideoBytes: number, beforeDecode: () => void): CompletedOperation {
  const operation = record(payload);
  if (operation === undefined) throw providerFailure('Agent Platform Veo video generation failed or completed without a video result.');
  if (operation.error !== undefined) throw providerFailure('Agent Platform Veo video generation failed.', undefined, operationDiagnostic(operation));
  const response = record(operation.response);
  if (response === undefined) throw providerFailure('Agent Platform Veo video generation failed or completed without a video result.', undefined, { veoTerminalStatus: 'EMPTY_COMPLETED_OPERATION' });
  if (filtered(response)) throw providerFailure('Agent Platform Veo video generation failed or completed without a video result.', undefined, raiFilteredDiagnostic(response));
  const videos = response.videos; const video = Array.isArray(videos) && videos.length === 1 ? record(videos[0]) : undefined;
  if (video === undefined || video.mimeType !== 'video/mp4' || typeof video.bytesBase64Encoded !== 'string') throw providerFailure('Agent Platform Veo video generation completed without a valid inline MP4 result.');
  beforeDecode();
  return { operationName, video: decodeInlineMp4(video.bytesBase64Encoded, maxVideoBytes) };
}

function filtered(response: Record<string, unknown>): boolean { return typeof response.raiMediaFilteredCount === 'number' && response.raiMediaFilteredCount > 0; }
function raiFilteredDiagnostic(response: Record<string, unknown>) {
  const reasons = Array.isArray(response.raiMediaFilteredReasons) ? response.raiMediaFilteredReasons : [];
  return { veoTerminalStatus: 'RAI_FILTERED', raiMediaFilteredCount: response.raiMediaFilteredCount, raiMediaFilteredReason: reasons.find((reason) => typeof reason === 'string') };
}
function decodeInlineMp4(value: string, maxBytes: number): InlineVideo {
  const maxBase64Length = 4 * Math.ceil(maxBytes / 3);
  if (value.length === 0 || value.length > maxBase64Length) throw providerFailure('Agent Platform Veo inline video result was invalid or exceeded the supported size.');
  const decodedLength = base64DecodedLength(value);
  if (decodedLength === undefined || decodedLength > maxBytes) throw providerFailure('Agent Platform Veo inline video result was invalid or exceeded the supported size.');
  const bytes = new Uint8Array(decodedLength); let offset = 0;
  for (let start = 0; start < value.length; start += BASE64_DECODE_CHUNK_LENGTH) {
    const chunk = Buffer.from(value.slice(start, start + BASE64_DECODE_CHUNK_LENGTH), 'base64');
    bytes.set(chunk, offset); offset += chunk.byteLength;
  }
  if (offset !== decodedLength || bytes.byteLength < 8 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) throw providerFailure('Agent Platform Veo inline video result was invalid or exceeded the supported size.');
  return { mimeType: 'video/mp4', bytes };
}

/** Validates Base64 in one bounded pass before Node's permissive decoder sees it. */
function base64DecodedLength(value: string): number | undefined {
  if (value.length % 4 !== 0) return undefined;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  if (contentLength === 0 || (padding === 2 && contentLength % 4 !== 2) || (padding === 1 && contentLength % 4 !== 3)) return undefined;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2f)) return undefined;
  }
  return ((value.length / 4) * 3) - padding;
}

async function parseBoundedJson(response: Response, maxBytes: number): Promise<unknown> { const bytes = await readBoundedBytes(response, maxBytes); return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length'); if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) throw providerFailure('Agent Platform Veo operation response exceeded the maximum supported size.');
  if (response.body === null) throw providerFailure('Agent Platform Veo video service returned an unreadable response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw providerFailure('Agent Platform Veo operation response exceeded the maximum supported size.'); } chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

function requiredEnvironmentValue(environment: GoogleAgentPlatformVeoEnvironment, name: string): string { const value = environment[name]?.trim(); if (value === undefined || value.length === 0) throw new VidGenError('configuration', `Agent Platform Veo ${name} configuration is required.`); return value; }
function positiveSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function nonNegativeSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new VidGenError('invalid_argument', message); return value; }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function operationDiagnostic(operation: Record<string, unknown>) {
  const error = record(operation.error);
  if (error === undefined) return undefined;
  const message = typeof error.message === 'string' ? error.message : undefined;
  return sanitizeProviderDiagnostic({ providerCode: error.code, providerStatus: error.status, supportCode: supportCode(error, message), providerMessage: message });
}
function supportCode(error: Record<string, unknown>, message: string | undefined): unknown {
  const direct = error.supportCode ?? error.support_code;
  if (direct !== undefined) return direct;
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details.slice(0, 4)) {
    const recordDetail = record(detail); const metadata = record(recordDetail?.metadata);
    const value = recordDetail?.supportCode ?? recordDetail?.support_code ?? metadata?.supportCode ?? metadata?.support_code;
    if (value !== undefined) return value;
  }
  return /\bsupport(?:[ -]?code)?\s*[:#-]?\s*(\d{1,16})\b/iu.exec(message ?? '')?.[1];
}
function providerFailure(message: string, cause?: unknown, safeProviderDiagnostic?: unknown): VidGenError { return new VidGenError('generated_media', message, { ...(cause === undefined ? {} : { cause }), ...(safeProviderDiagnostic === undefined ? {} : { safeProviderDiagnostic }) }); }
type VeoProcessingStage = NonNullable<ReturnType<typeof sanitizeProviderDiagnostic>>['veoStage'];
interface VeoStageTracker { value: NonNullable<VeoProcessingStage>; }
function runtimeFailure(stage: NonNullable<VeoProcessingStage>, cause: unknown): VidGenError {
  if (cause instanceof VidGenError) return cause;
  return new VidGenError('generated_media', stage === 'result_decode' || stage === 'operation_parse' ? 'Agent Platform Veo result processing failed.' : stage === 'auth' ? 'Agent Platform Veo authentication failed.' : 'Agent Platform Veo video request failed.', {
    cause,
    safeProviderDiagnostic: { veoStage: stage, internalError: internalErrorName(cause), internalMessage: internalErrorMessage(cause) },
  });
}
function internalErrorName(cause: unknown): string { try { return typeof (cause as { name?: unknown })?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test((cause as { name: string }).name) ? (cause as { name: string }).name : 'Error'; } catch { return 'Error'; } }
function internalErrorMessage(cause: unknown): string { try { const message = (cause as { message?: unknown })?.message; return typeof message === 'string' ? message : 'Internal runtime error.'; } catch { return 'Internal runtime error.'; } }

interface InlineVideo { readonly mimeType: 'video/mp4'; readonly bytes: Uint8Array; }
interface CompletedOperation { readonly operationName: string; readonly video: InlineVideo; }
interface GeneratedSequence { readonly operationIds: readonly string[]; readonly video: InlineVideo; }
