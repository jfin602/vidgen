import { createHash } from 'node:crypto';

import type { CanonicalArticle } from '../core/canonical-input.ts';
import { VidGenError } from '../core/error.ts';
import { searchParallel, type ParallelSearchOptions } from '../integrations/parallel/search.ts';

export const WEB_MOMENTUM_METRIC = 'web-momentum';
export const WEB_MOMENTUM_VERSION = 'v1';
export const WEB_MOMENTUM_POLICY_ID = 'parallel-search-fast-10-12000-after-3d-v1';
export const WORKER_MOMENTUM_THRESHOLD_ENV = 'VIDGEN_WORKER_MOMENTUM_THRESHOLD';
export const WORKER_DAILY_EVALUATION_LIMIT_ENV = 'VIDGEN_WORKER_DAILY_EVALUATION_LIMIT';
const STOPWORDS = new Set('a an and are as at be by for from in into is it its of on or that the to with was were will after before about'.split(' '));
const SIGNAL = /\b(?:reaction|reacts?|backlash|response|responds?|analysis|analyst|follow[- ]?up|what it means|explainer)\b/iu;

export interface MomentumConfig { readonly threshold: number; readonly dailyEvaluationLimit: number; }
export interface MomentumEvidence { readonly url: string; readonly title: string; readonly domain: string; readonly publishedAt?: string; readonly excerptHash: string; readonly matchedTerms: readonly string[]; readonly reactionSignal: boolean; }
export interface MomentumScore { readonly signature: readonly string[]; readonly results: readonly MomentumEvidence[]; readonly components: { readonly breadth: number; readonly saturation: number; readonly freshness: number; readonly reaction: number; }; readonly score: number; }
export interface MomentumEvaluation extends MomentumScore { readonly metric: typeof WEB_MOMENTUM_METRIC; readonly version: typeof WEB_MOMENTUM_VERSION; readonly policyId: typeof WEB_MOMENTUM_POLICY_ID; readonly evaluatedAt: string; readonly searchId: string; readonly sessionId: string; readonly threshold: number; readonly decision: 'admitted' | 'skipped'; }

export function createMomentumConfig(environment: NodeJS.ProcessEnv = process.env): MomentumConfig {
  const threshold = bounded(environment[WORKER_MOMENTUM_THRESHOLD_ENV], WORKER_MOMENTUM_THRESHOLD_ENV, 0, 100);
  const dailyEvaluationLimit = wholeBounded(environment[WORKER_DAILY_EVALUATION_LIMIT_ENV], WORKER_DAILY_EVALUATION_LIMIT_ENV, 1, 10_000);
  return { threshold, dailyEvaluationLimit };
}
export function eventSignature(headline: string): readonly string[] {
  const terms = headline.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/u).filter((term) => term.length >= 3 && !STOPWORDS.has(term));
  return [...new Set(terms)].slice(0, 12);
}
export function momentumQueries(signature: readonly string[]): readonly string[] {
  if (signature.length < 2) return [];
  const subject = signature.slice(0, 4).join(' ').slice(0, 180);
  const suffixes = ['reaction', 'analysis', 'follow up'].filter((suffix) => !signature.includes(suffix));
  return [subject, ...suffixes.map((suffix) => `${subject} ${suffix}`).filter((query) => query.length <= 200)].slice(0, 3);
}
export function momentumObjective(article: CanonicalArticle): string {
  const summary = article.summary === null ? '' : ` Summary: ${boundedText(article.summary, 800)}.`;
  return boundedText(`Find recent independent coverage, reactions, analysis, and follow-up specifically about this event: ${boundedText(article.headline, 400)}.${summary} Governed source: ${boundedText(article.source.displayName, 160)}. Reject generic background popularity or unrelated coverage of the same people, company, product, or topic.`, 2_000);
}
export async function evaluateWebMomentum(article: CanonicalArticle, evaluatedAt: Date, config: MomentumConfig, options: ParallelSearchOptions = {}): Promise<MomentumEvaluation> {
  const signature = eventSignature(article.headline); const queries = momentumQueries(signature);
  if (signature.length < 2 || queries.length < 2) throw new VidGenError('invalid_argument', 'Article headline cannot form a meaningful Web Momentum event signature.');
  const evaluated = iso(evaluatedAt); const response = await searchParallel({ objective: momentumObjective(article), searchQueries: queries, afterDate: utcDateOffset(evaluatedAt, -3) }, options);
  const score = scoreWebMomentum(article.originalUrl, signature, response.results, evaluatedAt);
  return { ...score, metric: WEB_MOMENTUM_METRIC, version: WEB_MOMENTUM_VERSION, policyId: WEB_MOMENTUM_POLICY_ID, evaluatedAt: evaluated, searchId: response.searchId, sessionId: response.sessionId, threshold: config.threshold, decision: score.score >= config.threshold ? 'admitted' : 'skipped' };
}
export function scoreWebMomentum(originalUrl: string, signature: readonly string[], rawResults: readonly unknown[], evaluatedAt: Date): MomentumScore {
  const publisher = domainOf(originalUrl); const results = rawResults.slice(0, 10).map((value) => normalizeResult(value, signature)).filter((value): value is MomentumEvidence => value !== undefined);
  const matched = results.filter((result) => result.matchedTerms.length >= 2 && result.matchedTerms.length / signature.length >= .35 && (signature.length !== 2 || result.matchedTerms.length === 2));
  const independent = new Set(matched.filter((result) => result.domain !== publisher).map((result) => result.domain));
  const reactions = new Set(matched.filter((result) => result.domain !== publisher && result.reactionSignal).map((result) => result.domain));
  const breadth = Math.round(40 * Math.min(independent.size, 8) / 8);
  const saturation = Math.round(25 * Math.min(matched.length, 8) / 8);
  const freshness = Math.round(20 * (matched.length === 0 ? 0 : matched.reduce((sum, result) => sum + freshnessWeight(result.publishedAt, evaluatedAt), 0) / matched.length));
  const reaction = Math.round(15 * Math.min(reactions.size, 3) / 3);
  return { signature, results, components: { breadth, saturation, freshness, reaction }, score: Math.max(0, Math.min(100, breadth + saturation + freshness + reaction)) };
}
function normalizeResult(value: unknown, signature: readonly string[]): MomentumEvidence | undefined {
  if (!plain(value) || typeof value.url !== 'string' || typeof value.title !== 'string') return undefined;
  const url = safeUrl(value.url); if (!url) return undefined;
  const title = boundedText(value.title, 300).trim(); if (!title) return undefined;
  const excerpts = Array.isArray(value.excerpts) ? value.excerpts.filter((excerpt): excerpt is string => typeof excerpt === 'string').slice(0, 4).map((excerpt) => boundedText(excerpt, 1_000)).join(' ') : '';
  const words = terms(`${title} ${excerpts}`); const matchedTerms = signature.filter((term) => words.has(term));
  const publishedAt = dateOnly(value.publish_date);
  return { url, title, domain: domainOf(url), ...(publishedAt ? { publishedAt } : {}), excerptHash: createHash('sha256').update(excerpts).digest('hex'), matchedTerms, reactionSignal: SIGNAL.test(`${title} ${excerpts}`) };
}
function bounded(value: string | undefined, name: string, min: number, max: number): number { if (value === undefined || !/^\d+(?:\.\d+)?$/u.test(value.trim())) throw new VidGenError('configuration', `${name} must be explicitly set from ${min} through ${max}.`); const number = Number(value.trim()); if (!Number.isFinite(number) || number < min || number > max) throw new VidGenError('configuration', `${name} must be explicitly set from ${min} through ${max}.`); return number; }
function wholeBounded(value: string | undefined, name: string, min: number, max: number): number { const number = bounded(value, name, min, max); if (!Number.isSafeInteger(number)) throw new VidGenError('configuration', `${name} must be explicitly set from ${min} through ${max}.`); return number; }
function safeUrl(value: string): string | undefined { try { const url = new URL(value); if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hostname.length === 0 || value.length > 2_000) return undefined; url.search = ''; url.hash = ''; return url.toString(); } catch { return undefined; } }
function domainOf(value: string): string { return new URL(value).hostname.toLowerCase().replace(/^www\./u, ''); }
function terms(value: string): Set<string> { return new Set(value.toLocaleLowerCase('en-US').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u)); }
function dateOnly(value: unknown): string | undefined { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) ? value : undefined; }
function freshnessWeight(value: string | undefined, now: Date): number { if (!value) return 0; const age = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${value}T00:00:00.000Z`)) / 86_400_000); return [1, .75, .5, .25][age] ?? 0; }
function utcDateOffset(now: Date, offset: number): string { const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)); return date.toISOString().slice(0, 10); }
function iso(value: Date): string { if (Number.isNaN(value.valueOf())) throw new VidGenError('invalid_argument', 'Worker clock produced an invalid timestamp.'); return value.toISOString(); }
function boundedText(value: string, max: number): string { return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max); }
function plain(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
