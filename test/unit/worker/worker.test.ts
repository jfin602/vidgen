import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createWorkerRuntimeConfig, DEFAULT_WORKER_POLL_INTERVAL_MS } from '../../../src/worker/config.ts';
import { parseWorkerCliArgs, workerHelpText } from '../../../src/worker-cli.ts';
import { runNgestWorker, runNgestWorkerCycle, runWorkerCycle } from '../../../src/worker/runtime.ts';
import { createDiscoveredCandidate, emptyWorkerState, WORKER_STATE_FILE, WorkerStateStore } from '../../../src/worker/state.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { buildStoryInput } from '../../../src/core/story-input.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

const at = () => new Date('2026-09-08T12:00:00.000Z');

test('Worker CLI accepts its isolated modes and bounded controls', () => {
  assert.deepEqual(parseWorkerCliArgs(['observe', '--once', '--process-existing', '--max-candidates', '2', '--state-root', 'temp/worker', '--poll-interval-ms', '1000']), {
    mode: 'observe', once: true, processExisting: true, maxCandidates: 2, stateRoot: 'temp/worker', pollIntervalMs: 1000,
  });
  for (const mode of ['observe', 'generate', 'live']) assert.equal((parseWorkerCliArgs([mode]) as { mode: string }).mode, mode);
  assert.match(workerHelpText, /--once/); assert.match(workerHelpText, /--process-existing/); assert.match(workerHelpText, /--max-candidates/);
  assert.equal((parseWorkerCliArgs(['generate', '--poll-interval-ms', '60000']) as { pollIntervalMs: number }).pollIntervalMs, 60_000);
  assert.throws(() => parseWorkerCliArgs(['generate', '--max-candidates', '0']), /positive whole number/);
  assert.throws(() => parseWorkerCliArgs(['generate', '--poll-interval-ms', '1']), /1000 through/);
});

test('Worker runtime configuration defaults under artifacts and rejects unbounded intervals', () => {
  const config = createWorkerRuntimeConfig();
  assert.match(config.stateRoot.replaceAll('\\', '/'), /artifacts\/worker$/); assert.equal(config.pollIntervalMs, DEFAULT_WORKER_POLL_INTERVAL_MS);
  assert.throws(() => createWorkerRuntimeConfig({ pollIntervalMs: 999 }), /1000 through/);
  assert.throws(() => createWorkerRuntimeConfig({ stateRoot: '' }), /state root/);
});

test('Worker state publication is atomic and malformed persisted state is rejected safely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root, { createTemporarySuffix: () => 'fixed' });
    const state = { ...emptyWorkerState(), initialized: true, candidates: { article_1: createDiscoveredCandidate('article_1', at().toISOString()) } };
    await store.save(state);
    assert.deepEqual(await store.load(), state);
    assert.equal((await readFile(join(root, WORKER_STATE_FILE), 'utf8')).includes('.tmp-fixed'), false);
    await writeFile(join(root, WORKER_STATE_FILE), '{"version":1,"initialized":true,"candidates":{"../unsafe":{}}}', 'utf8');
    await assert.rejects(store.load(), /Worker state is malformed\./);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('restart makes an in-progress external stage uncertain and never repeats it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root);
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: { article_1: { ...createDiscoveredCandidate('article_1', at().toISOString()), evaluation: { status: 'running', startedAt: at().toISOString() } } } });
    let evaluations = 0;
    const state = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'observe', maxCandidates: 1, now: at, runners: { evaluate: async () => { evaluations += 1; return evaluation('admitted'); } } });
    assert.equal(state.candidates.article_1!.evaluation.status, 'uncertain'); assert.equal(evaluations, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the first snapshot is a durable baseline until explicit backfill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root); let evaluations = 0;
    const runners = { evaluate: async () => { evaluations += 1; return evaluation('admitted'); } };
    const baseline = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'observe', maxCandidates: 1, now: at, runners });
    assert.equal(baseline.candidates.article_1!.baseline, true); assert.equal(evaluations, 0);
    await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'observe', maxCandidates: 1, now: at, runners });
    assert.equal(evaluations, 0);
    const backfill = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'observe', processExisting: true, maxCandidates: 1, now: at, runners });
    assert.equal(backfill.candidates.article_1!.baseline, undefined); assert.equal(backfill.candidates.article_1!.evaluation.status, 'succeeded'); assert.equal(evaluations, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ngest polling baselines once, discovers unseen Articles in feed order, and persists compatible fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root); let evaluations: string[] = [];
    const first = validManifest();
    const baseline = await runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, now: at, fetchManifest: async () => first, runners: { evaluate: async (id) => { evaluations.push(id); return evaluation('admitted'); } } });
    assert.deepEqual(Object.keys(baseline.candidates), ['article-1', 'article-2']);
    assert.equal(baseline.candidates['article-1']!.baseline, true); assert.deepEqual(evaluations, []);

    const next = validManifest();
    next.articles = [...next.articles, {
      ...next.articles[0]!, articleId: 'article-3', headline: 'Third governed headline', originalUrl: 'https://publisher.example.test/story-3',
    }, {
      ...next.articles[0]!, articleId: 'article-4', headline: 'Fourth governed headline', originalUrl: 'https://publisher.example.test/story-4',
    }];
    const discovered = await runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, now: at, fetchManifest: async () => next, runners: { evaluate: async (id) => { evaluations.push(id); return evaluation('admitted'); } } });
    assert.deepEqual(evaluations, ['article-3']);
    assert.equal(discovered.candidates['article-3']!.evaluation.status, 'succeeded');
    assert.equal(discovered.candidates['article-4']!.evaluation.status, 'pending');
    const fixture = await loadNgestVidGenManifestFile(store.candidateFixturePath('article-3'));
    assert.deepEqual(fixture.articles.map((article) => article.articleId), ['article-3']);
    assert.equal(buildStoryInput(buildCanonicalInput(fixture), 'article-3').article.headline, 'Third governed headline');
    assert.equal((await loadNgestVidGenManifestFile(store.candidateFixturePath('article-4'))).articles[0]!.articleId, 'article-4');

    await runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, now: at, fetchManifest: async () => next, runners: { evaluate: async (id) => { evaluations.push(id); return evaluation('admitted'); } } });
    assert.deepEqual(evaluations, ['article-3', 'article-4']);
    await runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, now: at, fetchManifest: async () => next, runners: { evaluate: async (id) => { evaluations.push(id); return evaluation('admitted'); } } });
    assert.deepEqual(evaluations, ['article-3', 'article-4']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('--once fetches exactly one coherent ngest snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    let polls = 0;
    await runNgestWorker({ store: new WorkerStateStore(root), mode: 'observe', once: true, maxCandidates: 1, pollIntervalMs: 1_000, fetchManifest: async () => { polls += 1; return validManifest(); } });
    assert.equal(polls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ngest --process-existing makes the first snapshot eligible while candidate limits do not erase discoveries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root); const evaluations: string[] = [];
    const state = await runNgestWorkerCycle({
      store, mode: 'observe', processExisting: true, maxCandidates: 1, now: at, fetchManifest: async () => validManifest(),
      runners: { evaluate: async (id) => { evaluations.push(id); return evaluation('admitted'); } },
    });
    assert.deepEqual(evaluations, ['article-1']);
    assert.equal(state.candidates['article-1']!.baseline, undefined);
    assert.equal(state.candidates['article-2']!.baseline, undefined);
    assert.equal(state.candidates['article-2']!.evaluation.status, 'pending');
    assert.ok(await readFile(store.candidateFixturePath('article-2'), 'utf8'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ngest poll errors, malformed or duplicate candidates, and fixture persistence failures do not advance discovery state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root);
    await assert.rejects(runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, fetchManifest: async () => { throw new Error('unavailable'); } }));
    assert.deepEqual(await store.load(), emptyWorkerState());

    const duplicate = validManifest(); duplicate.articles = [...duplicate.articles, { ...duplicate.articles[0]! }];
    await assert.rejects(runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, fetchManifest: async () => duplicate }), /duplicate Article IDs/);
    assert.deepEqual(await store.load(), emptyWorkerState());

    const malformed = validManifest(); malformed.articles = [{ ...malformed.articles[0]!, articleId: 'malformed', originalUrl: 'not-a-url' }];
    await assert.rejects(runNgestWorkerCycle({ store, mode: 'observe', maxCandidates: 1, fetchManifest: async () => malformed }), /absolute HTTP/);
    assert.deepEqual(await store.load(), emptyWorkerState());

    const failingStore = new WorkerStateStore(join(root, 'failing'), {
      filesystem: {
        mkdir: async () => undefined,
        readFile: async () => { const error = new Error('missing') as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error; },
        writeFile: async () => undefined,
        rename: async () => { throw new Error('no'); },
        unlink: async () => undefined,
      },
    });
    await assert.rejects(runNgestWorkerCycle({ store: failingStore, mode: 'observe', maxCandidates: 1, fetchManifest: async () => validManifest() }), /candidate fixture/);
    assert.deepEqual(await failingStore.load(), emptyWorkerState());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('successful evaluation and generation survive later failures, and modes keep stages separate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-'));
  try {
    const store = new WorkerStateStore(root); let generated = 0; let published = 0;
    const state = await runWorkerCycle({
      store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'live', processExisting: true, maxCandidates: 2, publicationPlatforms: ['x', 'bluesky'], now: at,
      runners: {
        evaluate: async () => evaluation('admitted'),
        generate: async (id) => { generated += 1; if (id === 'article_2') throw new Error('Bearer secret-token'); },
        publish: async (_id, platform) => { published += 1; if (platform === 'bluesky') throw new Error('Bearer secret-token'); },
      },
    });
    const candidate = state.candidates.article_1!;
    assert.equal(candidate.evaluation.status, 'succeeded'); assert.equal(candidate.admission.status, 'succeeded'); assert.equal(candidate.generation.status, 'succeeded');
    assert.equal(candidate.publication.x!.status, 'succeeded'); assert.equal(candidate.publication.bluesky!.status, 'failed');
    assert.equal(state.candidates.article_2!.evaluation.status, 'succeeded'); assert.equal(state.candidates.article_2!.generation.status, 'failed');
    assert.equal(generated, 2); assert.equal(published, 2);
    assert.equal(JSON.stringify(state).includes('secret-token'), false);
    const observed = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'observe', maxCandidates: 2, now: at, runners: { evaluate: async () => { throw new Error('must not repeat'); } } });
    assert.equal(observed.candidates.article_1!.generation.status, 'succeeded');
    assert.equal(observed.candidates.article_2!.generation.status, 'failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

function evaluation(decision: 'admitted' | 'skipped') { return { metric: 'web-momentum', version: 'v1', score: 3, threshold: 2, decision, evaluatedAt: at().toISOString(), queryId: 'query-1', evidenceId: 'evidence-1' } as const; }
