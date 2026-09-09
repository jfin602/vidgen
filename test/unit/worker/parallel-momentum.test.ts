import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { searchParallel, PARALLEL_SEARCH_ENDPOINT } from '../../../src/integrations/parallel/search.ts';
import { parseWorkerCliArgs } from '../../../src/worker-cli.ts';
import { labelWorkerEvaluation, reportWorkerCalibration } from '../../../src/worker/calibration.ts';
import { runNgestWorkerCycle } from '../../../src/worker/runtime.ts';
import { createDiscoveredCandidate, emptyWorkerState, type WorkerState, WorkerStateStore } from '../../../src/worker/state.ts';
import { createMomentumConfig, evaluateWebMomentum, eventSignature, momentumQueries, scoreWebMomentum, WEB_MOMENTUM_POLICY_ID } from '../../../src/worker/web-momentum.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

const now = new Date('2026-09-08T12:00:00.000Z');
const article = { articleId: 'article-1', headline: 'Acme launches orbital probe', originalUrl: 'https://publisher.example/event', effectiveFeedDate: '2026-09-08', feedDateSource: 'feed', publishedAt: null, author: null, summary: 'A new orbital mission.', imageUrl: null, source: { configKey: 'publisher', displayName: 'Publisher' }, categories: [] } as const;
const environment = { PARALLEL_API_KEY: 'parallel-secret', VIDGEN_WORKER_MOMENTUM_THRESHOLD: '50', VIDGEN_WORKER_DAILY_EVALUATION_LIMIT: '10' };
const result = (domain: string, title = 'Acme launches orbital analysis reaction', publish_date = '2026-09-08') => ({ url: `https://${domain}/story`, title, publish_date, excerpts: ['Independent analysis and reaction to Acme launches.'] });

test('Parallel uses one exact bounded v1 request and never leaks its key', async () => {
  const calls: { input: string | URL | Request; init?: RequestInit }[] = [];
  const value = await evaluateWebMomentum(article, now, createMomentumConfig(environment), { environment, fetch: async (input, init) => { calls.push({ input, init }); return json({ search_id: 'search_1', session_id: 'session_1', results: [result('news.example')] }); } });
  assert.equal(calls.length, 1); assert.equal(String(calls[0]!.input), PARALLEL_SEARCH_ENDPOINT); assert.equal(calls[0]!.init?.method, 'POST'); assert.equal(calls[0]!.init?.redirect, 'manual');
  assert.deepEqual(calls[0]!.init?.headers, { 'content-type': 'application/json', 'x-api-key': 'parallel-secret' });
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { objective: 'Find recent independent coverage, reactions, analysis, and follow-up specifically about this event: Acme launches orbital probe. Summary: A new orbital mission.. Governed source: Publisher. Reject generic background popularity or unrelated coverage of the same people, company, product, or topic.', search_queries: ['acme launches orbital probe', 'acme launches orbital probe reaction', 'acme launches orbital probe analysis'], mode: 'fast', max_chars_total: 12000, advanced_settings: { max_results: 10, source_policy: { after_date: '2026-09-05' } } });
  assert.equal(value.policyId, WEB_MOMENTUM_POLICY_ID); assert.equal(value.decision, 'skipped'); assert.equal(JSON.stringify(value).includes('parallel-secret'), false);
});

test('Parallel fails closed for redirect, timeout, oversized, malformed, unsafe, and unsuccessful responses without retries', async () => {
  const request = { objective: 'objective', searchQueries: ['event reaction', 'event analysis'], afterDate: '2026-09-05' };
  const failures: [string, typeof fetch][] = [
    ['redirect', async () => new Response('', { status: 302 })],
    ['oversized', async () => new Response('{}', { headers: { 'content-length': '999999' } })],
    ['malformed', async () => new Response('{not json')],
    ['unsafe', async () => json({ search_id: 'search_1', session_id: 'session_1', results: [{ url: 'file:///secret', title: 'x' }] })],
    ['timeout', ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('secret parallel-secret'))))) as typeof fetch],
  ];
  for (const [name, fetch] of failures) await assert.rejects(searchParallel(request, { environment: { ...environment, PARALLEL_TIMEOUT_MS: name === 'timeout' ? '1' : '100' }, fetch }), (error: unknown) => String(error).includes('parallel-secret') === false);
  let calls = 0; await assert.rejects(searchParallel(request, { environment, fetch: async () => { calls += 1; return new Response('', { status: 500 }); } }), /unsuccessful/); assert.equal(calls, 1);
});

test('event matching, normalization, source exclusion, and every Web Momentum component are deterministic and bounded', () => {
  const signature = eventSignature(article.headline); assert.deepEqual(signature, ['acme', 'launches', 'orbital', 'probe']); assert.deepEqual(momentumQueries(signature), ['acme launches orbital probe', 'acme launches orbital probe reaction', 'acme launches orbital probe analysis']); assert.deepEqual(momentumQueries(['only']), []);
  const full = scoreWebMomentum(article.originalUrl, signature, [...Array.from({ length: 8 }, (_, index) => result(`news-${index}.example`)), { url: 'file:///unsafe', title: 'Acme launches orbital probe', excerpts: ['reaction'] }], now);
  assert.deepEqual(full.components, { breadth: 40, saturation: 25, freshness: 20, reaction: 15 }); assert.equal(full.score, 100); assert.equal(full.results.length, 8); assert.equal(full.results[0]!.excerptHash.length, 64); assert.equal(Object.hasOwn(full.results[0]!, 'excerpts'), false);
  const publisherOnly = scoreWebMomentum(article.originalUrl, signature, [result('publisher.example')], now);
  assert.deepEqual(publisherOnly.components, { breadth: 0, saturation: 3, freshness: 20, reaction: 0 }); assert.equal(publisherOnly.score, 23);
  const dated = scoreWebMomentum(article.originalUrl, signature, [result('news.example', undefined, '2026-09-06')], now);
  assert.equal(dated.components.freshness, 10); assert.ok(dated.score >= 0 && dated.score <= 100);
});

test('Worker reuses a completed evaluation, blocks daily budget, and observe never generates or publishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-parallel-'));
  try {
    const store = new WorkerStateStore(root); let calls = 0; let generation = 0; let publication = 0;
    const fetch: typeof globalThis.fetch = async () => { calls += 1; return json({ search_id: `search_${calls}`, session_id: `session_${calls}`, results: [result('news.example', 'First governed headline analysis reaction')] }); };
    const env = { ...environment, VIDGEN_WORKER_MOMENTUM_THRESHOLD: '0', VIDGEN_WORKER_DAILY_EVALUATION_LIMIT: '1' };
    const first = await runNgestWorkerCycle({ store, mode: 'observe', processExisting: true, maxCandidates: 2, environment: env, parallelFetch: fetch, fetchManifest: async () => validManifest(), runners: { generate: async () => { generation += 1; }, publish: async () => { publication += 1; } } });
    assert.equal(calls, 1); assert.equal(first.candidates['article-1']!.evaluationResult?.decision, 'admitted'); assert.equal(first.candidates['article-2']!.evaluationResult?.budgetBlocked, true); assert.equal(generation, 0); assert.equal(publication, 0);
    await runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 2, environment: env, parallelFetch: fetch, fetchManifest: async () => validManifest() }); assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local owner labels preserve automatic decisions and report precision/recall', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-calibration-'));
  try {
    const store = new WorkerStateStore(root); const candidate = createDiscoveredCandidate('article-1', now.toISOString());
    const evaluation = { metric: 'web-momentum', version: 'v1', policyId: WEB_MOMENTUM_POLICY_ID, score: 100, threshold: 50, decision: 'admitted' as const, evaluatedAt: now.toISOString(), searchId: 'search_1', sessionId: 'session_1', signature: ['acme', 'launches'], results: [], components: { breadth: 40, saturation: 25, freshness: 20, reaction: 15 } };
    const second = { ...candidate, id: 'article-2', evaluation: { status: 'succeeded' as const }, admission: { status: 'skipped' as const }, evaluationResult: { ...evaluation, decision: 'skipped' as const, score: 0 } };
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: { 'article-1': { ...candidate, evaluation: { status: 'succeeded' }, admission: { status: 'succeeded' }, evaluationResult: evaluation }, 'article-2': second } } as WorkerState);
    await labelWorkerEvaluation(store, 'article-1', 'generate'); await labelWorkerEvaluation(store, 'article-2', 'generate');
    const persisted = await store.load(); assert.equal(persisted.candidates['article-2']!.evaluationResult?.decision, 'skipped');
    assert.deepEqual(parseWorkerCliArgs(['label', 'article-1', 'generate', '--state-root', root]), { kind: 'label', candidateId: 'article-1', label: 'generate', stateRoot: root }); assert.deepEqual(parseWorkerCliArgs(['report', '--state-root', root]), { kind: 'report', stateRoot: root });
    assert.deepEqual(reportWorkerCalibration(persisted), { metric: 'web-momentum', version: 'v1', labeledCount: 2, confusion: { truePositive: 1, falsePositive: 0, trueNegative: 0, falseNegative: 1 }, precision: 1, recall: .5 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
