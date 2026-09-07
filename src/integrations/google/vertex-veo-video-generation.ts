import { VidGenError } from '../../core/error.ts';
import type { ApprovedReferenceImage, VideoGenerationClient, VideoGenerationRequest, VideoGenerationResult } from '../../core/generated-media.ts';
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
export const VIDGEN_VERTEX_VIDEO_MODEL_ENV = 'VIDGEN_VERTEX_VIDEO_MODEL';
export const VERTEX_VEO_LOCATION = 'us-central1';
export const VERTEX_VEO_API_BASE = `https://${VERTEX_VEO_LOCATION}-aiplatform.googleapis.com/v1`;
export const DEFAULT_VERTEX_VEO_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_VERTEX_VEO_TOTAL_TIMEOUT_MS = 360_000;
export const DEFAULT_VERTEX_VEO_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_VERTEX_VEO_AUTH_TIMEOUT_MS = 30_000;
export const DEFAULT_VERTEX_VEO_MAX_RESPONSE_BYTES = 140_000_000;
export const DEFAULT_VERTEX_VEO_MAX_VIDEO_BYTES = 100_000_000;
export const DEFAULT_VERTEX_VEO_MAX_EXTENSION_COUNT = 3;

const INITIAL_DURATION_SECONDS = 8;
const EXTENSION_DURATION_SECONDS = 7;
const SUPPORTED_MODELS = new Set(['veo-3.1-generate-001', 'veo-3.1-fast-generate-001']);
const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const SAFE_ACCESS_TOKEN = /^[A-Za-z0-9._~-]{1,16384}$/;

export type VertexVeoEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;
export type VertexAccessTokenProvider = () => Promise<string>;

export interface VertexVeoRuntimeConfig {
  readonly project: string;
  readonly location: typeof VERTEX_VEO_LOCATION;
  readonly model: string;
}

export interface VertexVeoVideoGenerationClientOptions {
  readonly environment?: VertexVeoEnvironment;
  readonly fetch?: FetchImplementation;
  /** Injectable so tests never need ambient ADC. */
  readonly getAccessToken?: VertexAccessTokenProvider;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly totalTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly authTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxVideoBytes?: number;
  readonly maxExtensionCount?: number;
}

/** Loads only Vertex runtime identity; Developer API credentials are never read here. */
export function loadVertexVeoRuntimeConfig(environment: VertexVeoEnvironment = process.env): VertexVeoRuntimeConfig {
  const project = requiredEnvironmentValue(environment, GOOGLE_CLOUD_PROJECT_ENV);
  const location = requiredEnvironmentValue(environment, GOOGLE_CLOUD_LOCATION_ENV);
  const model = requiredEnvironmentValue(environment, VIDGEN_VERTEX_VIDEO_MODEL_ENV);
  if (!SAFE_PROJECT.test(project) || location !== VERTEX_VEO_LOCATION || !SUPPORTED_MODELS.has(model)) {
    throw new VidGenError('configuration', 'Vertex Veo project, location, or model configuration is invalid.');
  }
  return { project, location: VERTEX_VEO_LOCATION, model };
}

/** Vertex REST Veo adapter. It exposes only neutral raw media and safe operation provenance. */
export class VertexVeoVideoGenerationClient implements VideoGenerationClient, PresenterVideoGenerationClient {
  readonly provider = 'vertex-veo';
  readonly model: string;

  private readonly project: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly getAccessToken: VertexAccessTokenProvider;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly totalTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly authTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxVideoBytes: number;
  private readonly maxExtensionCount: number;

  constructor(options: VertexVeoVideoGenerationClientOptions = {}) {
    const config = loadVertexVeoRuntimeConfig(options.environment);
    this.project = config.project;
    this.model = config.model;
    this.fetchImplementation = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken ?? defaultAccessToken;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.pollIntervalMs = positiveSafeInteger(options.pollIntervalMs ?? DEFAULT_VERTEX_VEO_POLL_INTERVAL_MS, 'Vertex Veo poll interval must be a positive whole number of milliseconds.');
    this.totalTimeoutMs = positiveSafeInteger(options.totalTimeoutMs ?? DEFAULT_VERTEX_VEO_TOTAL_TIMEOUT_MS, 'Vertex Veo total timeout must be a positive whole number of milliseconds.');
    this.requestTimeoutMs = positiveSafeInteger(options.requestTimeoutMs ?? DEFAULT_VERTEX_VEO_REQUEST_TIMEOUT_MS, 'Vertex Veo request timeout must be a positive whole number of milliseconds.');
    this.authTimeoutMs = positiveSafeInteger(options.authTimeoutMs ?? DEFAULT_VERTEX_VEO_AUTH_TIMEOUT_MS, 'Vertex Veo authentication timeout must be a positive whole number of milliseconds.');
    this.maxResponseBytes = positiveSafeInteger(options.maxResponseBytes ?? DEFAULT_VERTEX_VEO_MAX_RESPONSE_BYTES, 'Vertex Veo maximum operation response size must be a positive whole number of bytes.');
    this.maxVideoBytes = positiveSafeInteger(options.maxVideoBytes ?? DEFAULT_VERTEX_VEO_MAX_VIDEO_BYTES, 'Vertex Veo maximum video size must be a positive whole number of bytes.');
    this.maxExtensionCount = nonNegativeSafeInteger(options.maxExtensionCount ?? DEFAULT_VERTEX_VEO_MAX_EXTENSION_COUNT, 'Vertex Veo maximum extension count must be a non-negative whole number.');
  }

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    validateVideoRequest(request);
    const extensionCount = requiredExtensionCount(request.unit.targetDurationSeconds);
    this.assertExtensionCount(extensionCount);
    const dialogue = request.unit.role.kind === 'presenter' ? partitionCinematicSpeech(request.unit.spokenText, extensionCount + 1) : [];
    const generated = await this.generateSequence(
      buildInitialRequest(request, dialogue[0]), extensionCount,
      (previous, index) => buildExtensionRequest(request, previous, dialogue[index + 1]),
    );
    return resultFor(this, generated, INITIAL_DURATION_SECONDS + (extensionCount * EXTENSION_DURATION_SECONDS));
  }

  async generatePresenterVideo(request: PresenterVideoGenerationRequest): Promise<PresenterVideoGenerationResult> {
    assertPresenterVideoGenerationRequest(request);
    assertVertexReferences(request.referenceImages);
    const durationPlan = planPresenterVideoDuration(request.maxSeconds);
    this.assertExtensionCount(durationPlan.extensionCount);
    const dialogue = partitionSimplePresenterSpeech(request.spokenText, request.maxSeconds);
    const retainedExtensionSeconds = Math.min(request.maxSeconds, durationPlan.rawProviderDurationSeconds) - INITIAL_DURATION_SECONDS;
    const generated = await this.generateSequence(
      buildSimpleInitialRequest(request, dialogue[0]!, durationPlan.extensionCount > 0), durationPlan.extensionCount,
      (previous, index) => buildSimpleExtensionRequest(previous, dialogue[index + 1] ?? '', retainedExtensionSeconds),
    );
    return { ...resultFor(this, generated), rawDurationSeconds: durationPlan.rawProviderDurationSeconds, durationPlan };
  }

  private assertExtensionCount(count: number): void {
    if (count > this.maxExtensionCount) throw providerFailure('Vertex Veo video request exceeds the configured extension limit.');
  }

  private async generateSequence(
    initialBody: Record<string, unknown>,
    extensionCount: number,
    extensionBody: (previous: InlineVideo, extensionIndex: number) => Record<string, unknown>,
  ): Promise<GeneratedSequence> {
    const token = await this.accessToken();
    const deadline = this.now() + this.totalTimeoutMs;
    const operationIds: string[] = [];
    let completed = await this.startAndWait(initialBody, token, deadline);
    operationIds.push(completed.operationName);
    let video = completed.video;
    for (let index = 0; index < extensionCount; index += 1) {
      completed = await this.startAndWait(extensionBody(video, index), token, deadline);
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
      throw providerFailure('Vertex Veo authentication failed.', cause);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  private async startAndWait(body: Record<string, unknown>, token: string, deadline: number): Promise<CompletedOperation> {
    this.assertBeforeDeadline(deadline);
    const started = await this.requestJson(this.modelUrl(':predictLongRunning'), body, token);
    const operationName = this.operationNameFrom(started);
    let operation = started;
    let polls = 0;
    while (!operationDone(operation)) {
      this.assertBeforeDeadline(deadline);
      if (polls >= Math.ceil(this.totalTimeoutMs / this.pollIntervalMs)) throw providerFailure('Vertex Veo video generation timed out.');
      try { await this.sleep(this.pollIntervalMs); } catch (cause) { throw providerFailure('Vertex Veo video generation polling failed.', cause); }
      this.assertBeforeDeadline(deadline);
      operation = await this.requestJson(this.modelUrl(':fetchPredictOperation'), { operationName }, token);
      polls += 1;
    }
    return completedOperation(operation, operationName, this.maxVideoBytes);
  }

  private async requestJson(url: string, body: Record<string, unknown>, token: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' });
    } catch (cause) {
      if (cause instanceof VidGenError) throw cause;
      throw providerFailure('Unable to reach the Vertex Veo video service.', cause);
    }
    if (!response.ok) throw providerFailure('Vertex Veo video service returned an unsuccessful response.');
    return parseBoundedJson(response, this.maxResponseBytes);
  }

  private modelUrl(suffix: ':predictLongRunning' | ':fetchPredictOperation'): string {
    return `${VERTEX_VEO_API_BASE}/projects/${this.project}/locations/${VERTEX_VEO_LOCATION}/publishers/google/models/${this.model}${suffix}`;
  }

  private operationNameFrom(payload: unknown): string {
    const name = record(payload)?.name;
    const expected = `projects/${this.project}/locations/${VERTEX_VEO_LOCATION}/publishers/google/models/${this.model}/operations/`;
    if (typeof name !== 'string' || !name.startsWith(expected) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(name.slice(expected.length))) {
      throw providerFailure('Vertex Veo video service returned an invalid operation identifier.');
    }
    return name;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try { return await this.fetchImplementation(url, { ...init, signal: controller.signal }); }
    catch (cause) { if (controller.signal.aborted) throw providerFailure('Vertex Veo video request timed out.', cause); throw cause; }
    finally { clearTimeout(timeout); }
  }

  private assertBeforeDeadline(deadline: number): void { if (this.now() >= deadline) throw providerFailure('Vertex Veo video generation timed out.'); }
}

function resultFor(client: VertexVeoVideoGenerationClient, generated: GeneratedSequence, durationSeconds?: number): VideoGenerationResult {
  return { provider: client.provider, model: client.model, requestId: generated.operationIds[0], operationId: generated.operationIds.at(-1), operationIds: generated.operationIds, generationOperationCount: generated.operationIds.length, mimeType: generated.video.mimeType, bytes: generated.video.bytes, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

function buildInitialRequest(request: VideoGenerationRequest, dialogue: string | undefined): Record<string, unknown> {
  const instance: Record<string, unknown> = { prompt: request.unit.role.kind === 'presenter' ? presenterPrompt(request, dialogue ?? request.unit.spokenText, false) : contentPrompt(request, false) };
  if (request.unit.role.kind === 'presenter') instance.referenceImages = request.referenceImages!.map(toAssetReference);
  return { instances: [instance], parameters: videoParameters(true) };
}

function buildExtensionRequest(request: VideoGenerationRequest, previous: InlineVideo, dialogue: string | undefined): Record<string, unknown> {
  return { instances: [{ prompt: request.unit.role.kind === 'presenter' ? presenterPrompt(request, dialogue ?? '', true) : contentPrompt(request, true), video: toInlineVideo(previous) }], parameters: videoParameters(false) };
}

function buildSimpleInitialRequest(request: PresenterVideoGenerationRequest, dialogue: string, requiresExtension: boolean): Record<string, unknown> {
  return { instances: [{ prompt: simplePresenterPrompt(dialogue, false, requiresExtension), referenceImages: request.referenceImages.map(toAssetReference) }], parameters: videoParameters(true) };
}

function buildSimpleExtensionRequest(previous: InlineVideo, dialogue: string, retainedExtensionSeconds: number): Record<string, unknown> {
  return { instances: [{ prompt: simplePresenterPrompt(dialogue, true, false, retainedExtensionSeconds), video: toInlineVideo(previous) }], parameters: videoParameters(false) };
}

function videoParameters(initial: boolean): Record<string, unknown> {
  return { aspectRatio: '9:16', ...(initial ? { durationSeconds: INITIAL_DURATION_SECONDS } : {}), resolution: '720p', sampleCount: 1 };
}

function presenterPrompt(request: VideoGenerationRequest, dialogue: string, extension: boolean): string {
  return ['Create a portrait news-presenter video.', extension ? 'Continue the same presenter, appearance, setting, and scene continuity from the supplied prior Veo video.' : 'Preserve the intended anchor appearance from the supplied reference images.', `Use only this supplied ClipPlan visual/news context: ${unitContext(request)}.`, `The presenter must speak only this exact assigned dialogue: "${dialogue}".`, 'Do not add dialogue. Do not create readable or generated on-screen text. Do not add unsupported story facts.'].join(' ');
}

function simplePresenterPrompt(dialogue: string, extension: boolean, requiresExtension = false, retainedExtensionSeconds?: number): string {
  return ['Create a portrait news-presenter video.', extension ? 'Continue the same presenter, appearance, setting, and scene continuity from the supplied prior Veo video.' : 'Preserve the intended anchor appearance from the supplied reference images.', `The presenter must speak only this exact assigned dialogue: "${dialogue}".`, ...(requiresExtension ? ["Keep the presenter speaking through this initial 8-second clip's final second so the required Veo extension can continue the voice."] : []), ...(extension ? [`Begin this exact assigned dialogue immediately and finish it within the first ${retainedExtensionSeconds} seconds of this 7-second extension, the only portion retained in the final clip. After that dialogue, add no speech.`] : []), 'Do not add dialogue. Do not create readable or generated on-screen text. Do not add unsupported story facts.'].join(' ');
}

function contentPrompt(request: VideoGenerationRequest, extension: boolean): string {
  return [extension ? 'Continue the same supplied visual treatment from the prior Veo video.' : 'Create a portrait news B-roll video.', `Remain grounded only in this supplied ClipPlan content: ${unitContext(request)}.`, 'Do not introduce new specific story claims. Do not add dialogue or voice narration.', 'Do not create readable or generated on-screen text. Do not retrieve or reuse publisher media.'].join(' ');
}

function unitContext(request: VideoGenerationRequest): string { return request.unit.content.map((value) => `${value.usage} ${value.slotId}: ${value.text}`).join(' | '); }
function toAssetReference(image: ApprovedReferenceImage): Record<string, unknown> { return { image: { bytesBase64Encoded: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType }, referenceType: 'asset' }; }
function toInlineVideo(video: InlineVideo): Record<string, unknown> { return { bytesBase64Encoded: Buffer.from(video.bytes).toString('base64'), mimeType: video.mimeType }; }

function validateVideoRequest(request: VideoGenerationRequest): void {
  if (request === null || typeof request !== 'object' || request.unit === undefined) throw new VidGenError('invalid_argument', 'Vertex Veo video generation request is invalid.');
  if (!Number.isFinite(request.unit.targetDurationSeconds) || request.unit.targetDurationSeconds <= 0 || !['presenter', 'video'].includes(request.unit.role.kind) || request.unit.content.length === 0) throw new VidGenError('generated_media', 'Vertex Veo video generation request is invalid.');
  if (request.unit.role.kind === 'presenter') {
    if (request.referenceImages === undefined || request.unit.spokenText.trim().length === 0) throw new VidGenError('generated_media', 'Vertex Veo presenter generation requires approved reference images and spoken text.');
    assertVertexReferences(request.referenceImages);
  } else if (request.referenceImages !== undefined && request.referenceImages.length > 0) throw new VidGenError('generated_media', 'Vertex Veo video generation does not accept presenter reference images.');
}

function assertVertexReferences(references: readonly ApprovedReferenceImage[]): void {
  if (references.length < 1 || references.length > 3 || references.some((image) => !['image/png', 'image/jpeg'].includes(image.mimeType) || image.bytes.byteLength < 1)) throw new VidGenError('generated_media', 'Vertex Veo presenter generation requires one to three PNG or JPEG approved reference images.');
}

function partitionCinematicSpeech(text: string, chunks: number): readonly string[] {
  const normalized = text.trim().replace(/\s+/g, ' '); if (normalized.length === 0) throw new VidGenError('generated_media', 'Vertex Veo presenter generation requires spoken text.');
  const words = normalized.split(' '); const weight = INITIAL_DURATION_SECONDS + ((chunks - 1) * EXTENSION_DURATION_SECONDS); const result: string[] = []; let cursor = 0; let covered = 0;
  for (let index = 0; index < chunks; index += 1) { covered += index === 0 ? INITIAL_DURATION_SECONDS : EXTENSION_DURATION_SECONDS; const end = index === chunks - 1 ? words.length : Math.floor((words.length * covered) / weight); result.push(words.slice(cursor, end).join(' ')); cursor = end; }
  return result;
}

function requiredExtensionCount(seconds: number): number { return Math.max(0, Math.ceil((seconds - INITIAL_DURATION_SECONDS) / EXTENSION_DURATION_SECONDS)); }
function operationDone(payload: unknown): boolean { const operation = record(payload); if (operation === undefined || typeof operation.done !== 'boolean') throw providerFailure('Vertex Veo video service returned a malformed operation.'); if (operation.error !== undefined) throw providerFailure('Vertex Veo video generation failed.'); return operation.done; }

function completedOperation(payload: unknown, operationName: string, maxVideoBytes: number): CompletedOperation {
  const operation = record(payload); const response = operation === undefined ? undefined : record(operation.response);
  if (operation === undefined || operation.error !== undefined || response === undefined || filtered(response)) throw providerFailure('Vertex Veo video generation failed or completed without a video result.');
  const videos = response.videos; const video = Array.isArray(videos) && videos.length === 1 ? record(videos[0]) : undefined;
  if (video === undefined || video.mimeType !== 'video/mp4' || typeof video.bytesBase64Encoded !== 'string') throw providerFailure('Vertex Veo video generation completed without a valid inline MP4 result.');
  return { operationName, video: decodeInlineMp4(video.bytesBase64Encoded, maxVideoBytes) };
}

function filtered(response: Record<string, unknown>): boolean { return typeof response.raiMediaFilteredCount === 'number' && response.raiMediaFilteredCount > 0; }
function decodeInlineMp4(value: string, maxBytes: number): InlineVideo {
  const maxBase64Length = 4 * Math.ceil(maxBytes / 3);
  if (value.length === 0 || value.length > maxBase64Length || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw providerFailure('Vertex Veo inline video result was invalid or exceeded the supported size.');
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.byteLength < 8 || bytes.byteLength > maxBytes || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) throw providerFailure('Vertex Veo inline video result was invalid or exceeded the supported size.');
  return { mimeType: 'video/mp4', bytes };
}

async function parseBoundedJson(response: Response, maxBytes: number): Promise<unknown> { const bytes = await readBoundedBytes(response, maxBytes); try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch (cause) { throw providerFailure('Vertex Veo video service returned invalid JSON.', cause); } }
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length'); if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) throw providerFailure('Vertex Veo operation response exceeded the maximum supported size.');
  if (response.body === null) throw providerFailure('Vertex Veo video service returned an unreadable response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw providerFailure('Vertex Veo operation response exceeded the maximum supported size.'); } chunks.push(next.value); } }
  catch (cause) { if (cause instanceof VidGenError) throw cause; throw providerFailure('Vertex Veo video service returned an unreadable response.', cause); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

async function defaultAccessToken(): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  const token = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken();
  if (token === null) throw new Error('missing token');
  return token;
}

function requiredEnvironmentValue(environment: VertexVeoEnvironment, name: string): string { const value = environment[name]?.trim(); if (value === undefined || value.length === 0) throw new VidGenError('configuration', `Vertex Veo ${name} configuration is required.`); return value; }
function positiveSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function nonNegativeSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new VidGenError('invalid_argument', message); return value; }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function providerFailure(message: string, cause?: unknown): VidGenError { return new VidGenError('generated_media', message, cause === undefined ? {} : { cause }); }

interface InlineVideo { readonly mimeType: 'video/mp4'; readonly bytes: Uint8Array; }
interface CompletedOperation { readonly operationName: string; readonly video: InlineVideo; }
interface GeneratedSequence { readonly operationIds: readonly string[]; readonly video: InlineVideo; }
