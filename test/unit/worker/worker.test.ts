import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createWorkerRuntimeConfig, DEFAULT_WORKER_POLL_INTERVAL_MS } from '../../../src/worker/config.ts';
import { parseWorkerCliArgs, workerHelpText } from '../../../src/worker-cli.ts';
import { runWorkerCycle } from '../../../src/worker/runtime.ts';
import { createDiscoveredCandidate, emptyWorkerState, WORKER_STATE_FILE, WorkerStateStore } from '../../../src/worker/state.ts';

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
