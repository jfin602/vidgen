import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createWorkerRuntimeConfig, DEFAULT_WORKER_MAX_SECONDS, DEFAULT_WORKER_POLL_INTERVAL_MS } from '../../../src/worker/config.ts';
import { parseWorkerCliArgs, workerHelpText } from '../../../src/worker-cli.ts';
import { createPosterRunners, runNgestWorker, runNgestWorkerCycle, runWorkerCycle } from '../../../src/worker/runtime.ts';
import { createDiscoveredCandidate, emptyWorkerState, isWorkerCandidateComplete, WORKER_STATE_FILE, WorkerStateStore } from '../../../src/worker/state.ts';
import { WEB_MOMENTUM_POLICY_ID } from '../../../src/worker/web-momentum.ts';
import { parseHeadlineSuccessOutput, runHeadlineHandoff } from '../../../src/worker/headline-handoff.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { buildStoryInput } from '../../../src/core/story-input.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

const at = () => new Date('2026-09-08T12:00:00.000Z');

test('Worker CLI accepts its isolated modes and bounded controls', () => {
  assert.deepEqual(parseWorkerCliArgs(['observe', '--once', '--process-existing', '--max-candidates', '2', '--state-root', 'temp/worker', '--poll-interval-ms', '1000']), {
    mode: 'observe', once: true, processExisting: true, maxCandidates: 2, stateRoot: 'temp/worker', pollIntervalMs: 1000,
  });
  assert.equal((parseWorkerCliArgs(['observe']) as { mode: string }).mode, 'observe');
  const generated = parseWorkerCliArgs(['generate', '--anchor-reference', 'a; $HOME.png', '--anchor-reference', 'b.png', '--font-file', 'font & safe.ttf', '--max-seconds', '12', '--daily-generation-limit', '2', '--generation-attempt-limit', '3']) as { mode: string; maxSeconds: number; anchorReferencePaths: string[]; fontPath: string; dailyGenerationLimit: number; generationAttemptLimit: number };
  assert.deepEqual(generated, { mode: 'generate', once: false, processExisting: false, maxCandidates: 1, anchorReferencePaths: ['a; $HOME.png', 'b.png'], fontPath: 'font & safe.ttf', maxSeconds: 12, dailyGenerationLimit: 2, generationAttemptLimit: 3 });
  assert.throws(() => parseWorkerCliArgs(['generate']), /requires one to three/);
  assert.match(workerHelpText, /--once/); assert.match(workerHelpText, /--process-existing/); assert.match(workerHelpText, /--max-candidates/);
  assert.equal((parseWorkerCliArgs(['generate', '--anchor-reference', 'a', '--font-file', 'font', '--poll-interval-ms', '60000']) as { pollIntervalMs: number }).pollIntervalMs, 60_000);
  assert.throws(() => parseWorkerCliArgs(['generate', '--max-candidates', '0']), /positive whole number/);
  assert.throws(() => parseWorkerCliArgs(['generate', '--anchor-reference', 'a', '--font-file', 'font', '--poll-interval-ms', '1']), /1000 through/);
});

test('Worker runtime configuration defaults under artifacts and rejects unbounded intervals', () => {
  const config = createWorkerRuntimeConfig();
  assert.match(config.stateRoot.replaceAll('\\', '/'), /artifacts\/worker$/); assert.equal(config.pollIntervalMs, DEFAULT_WORKER_POLL_INTERVAL_MS); assert.equal(config.maxSeconds, DEFAULT_WORKER_MAX_SECONDS);
  assert.equal(createWorkerRuntimeConfig({ maxSeconds: 12 }).maxSeconds, 12);
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
      store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'live', processExisting: true, maxCandidates: 2, now: at, dailyGenerationLimit: 2,
      runners: {
        evaluate: async () => evaluation('admitted'),
        generate: async (id) => { generated += 1; if (id === 'article_2') throw new Error('Bearer secret-token'); return artifact(id); },
        doctor: async () => undefined,
        caption: async () => 'safe caption',
        publish: async (_id, platform) => { published += 1; if (platform === 'bluesky') throw new Error('Bearer secret-token'); },
      },
    });
    const candidate = state.candidates.article_1!;
    assert.equal(candidate.evaluation.status, 'succeeded'); assert.equal(candidate.admission.status, 'succeeded'); assert.equal(candidate.generation.status, 'succeeded');
    assert.equal(candidate.publication.x!.status, 'succeeded'); assert.equal(candidate.publication.bluesky!.status, 'failed');
    assert.equal(state.candidates.article_2!.evaluation.status, 'succeeded'); assert.equal(state.candidates.article_2!.generation.status, 'failed');
    assert.equal(generated, 2); assert.equal(published, 3);
    assert.equal(JSON.stringify(state).includes('secret-token'), false);
    const observed = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'observe', maxCandidates: 2, now: at, runners: { evaluate: async () => { throw new Error('must not repeat'); } } });
    assert.equal(observed.candidates.article_1!.generation.status, 'succeeded');
    assert.equal(observed.candidates.article_2!.generation.status, 'failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('live discovers fixed ready destinations before generation, fans out exact argv, and persists complete state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-poster-'));
  try {
    const calls: string[][] = []; let generated = 0;
    const state = await runWorkerCycle({
      store: new WorkerStateStore(root), discoveredCandidateIds: ['article_1'], mode: 'live', processExisting: true, maxCandidates: 1, now: at,
      runners: {
        evaluate: async () => evaluation('admitted'), generate: async () => { generated += 1; assert.deepEqual(calls, [['doctor', 'x'], ['doctor', 'bluesky'], ['doctor', 'reels']]); return artifact(); },
        caption: async () => '"First governed headline" by Publisher Main',
        ...createPosterRunners(async (arguments_) => { calls.push([...arguments_]); if (arguments_[0] === 'doctor' && arguments_[1] === 'bluesky') throw new Error('Bearer child-secret'); }),
      },
    });
    const candidate = state.candidates.article_1!;
    assert.equal(generated, 1); assert.deepEqual(candidate.publicationTargets, ['x', 'reels']); assert.deepEqual(calls, [
      ['doctor', 'x'], ['doctor', 'bluesky'], ['doctor', 'reels'],
      ['post', 'x', '--video', 'C:/worker/article_1.mp4', '--text', '"First governed headline" by Publisher Main'],
      ['post', 'reels', '--video', 'C:/worker/article_1.mp4', '--text', '"First governed headline" by Publisher Main'],
    ]);
    assert.equal(calls.flat().includes('--allow-duplicate'), false); assert.equal(isWorkerCandidateComplete(candidate), true); assert.equal(JSON.stringify(state).includes('child-secret'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('zero ready live targets hold generation, while observe and generate never call Poster', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-poster-'));
  try {
    let poster = 0; let generated = 0;
    const runners = { evaluate: async () => evaluation('admitted'), generate: async () => { generated += 1; return artifact(); }, doctor: async () => { poster += 1; throw new Error('not ready'); }, caption: async () => 'caption', publish: async () => { poster += 1; } };
    const held = await runWorkerCycle({ store: new WorkerStateStore(root), discoveredCandidateIds: ['article_1'], mode: 'live', processExisting: true, maxCandidates: 1, now: at, runners });
    assert.deepEqual(held.candidates.article_1!.publicationTargets, []); assert.equal(held.candidates.article_1!.generation.status, 'pending'); assert.equal(generated, 0); assert.equal(poster, 3); assert.equal(isWorkerCandidateComplete(held.candidates.article_1!), false);
    const suppressedStore = new WorkerStateStore(join(root, 'suppressed'));
    await runWorkerCycle({ store: suppressedStore, discoveredCandidateIds: ['article_2'], mode: 'observe', processExisting: true, maxCandidates: 1, now: at, runners });
    await runWorkerCycle({ store: suppressedStore, discoveredCandidateIds: ['article_2'], mode: 'generate', maxCandidates: 1, now: at, runners });
    assert.equal(poster, 3); assert.equal(generated, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('partial publication continues, reuses media, and bounds only unresolved platform retries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-poster-'));
  try {
    const store = new WorkerStateStore(root); let generated = 0; const posts: string[] = [];
    const runners = {
      evaluate: async () => evaluation('admitted'), doctor: async () => undefined, caption: async () => 'caption',
      generate: async () => { generated += 1; return artifact(); },
      publish: async (_id: string, platform: string) => { posts.push(platform); if (platform === 'bluesky') throw new Error('Authorization: secret'); },
    };
    const first = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'live', processExisting: true, maxCandidates: 1, now: at, publicationAttemptLimit: 2, runners });
    assert.deepEqual(posts, ['x', 'bluesky', 'reels']); assert.equal(first.candidates.article_1!.publication.x!.status, 'succeeded'); assert.equal(first.candidates.article_1!.publication.reels!.status, 'succeeded'); assert.equal(first.candidates.article_1!.publication.bluesky!.status, 'failed');
    const second = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'live', maxCandidates: 1, now: at, publicationAttemptLimit: 2, runners });
    assert.deepEqual(posts, ['x', 'bluesky', 'reels', 'bluesky']); assert.equal(generated, 1); assert.equal(second.candidates.article_1!.publicationAttempts!.bluesky, 2);
    const third = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'live', maxCandidates: 1, now: at, publicationAttemptLimit: 2, runners });
    assert.deepEqual(posts, ['x', 'bluesky', 'reels', 'bluesky']); assert.equal(third.candidates.article_1!.publication.bluesky!.status, 'blocked'); assert.equal(isWorkerCandidateComplete(third.candidates.article_1!), false); assert.equal(JSON.stringify(third).includes('secret'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('interrupted Poster publication remains uncertain and is never reposted as success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-poster-'));
  try {
    const store = new WorkerStateStore(root); const candidate = createDiscoveredCandidate('article_1', at().toISOString()); let posts = 0;
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: { article_1: {
      ...candidate, evaluation: { status: 'succeeded', completedAt: at().toISOString() }, admission: { status: 'succeeded', completedAt: at().toISOString() }, evaluationResult: evaluation('admitted'), generation: { status: 'succeeded', completedAt: at().toISOString() }, generatedArtifact: artifact(), publicationTargets: ['x'], publicationAttempts: { x: 1 }, publication: { x: { status: 'running', startedAt: at().toISOString() } },
    } } });
    const state = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'live', maxCandidates: 1, now: at, runners: { caption: async () => 'caption', publish: async () => { posts += 1; } } });
    assert.equal(state.candidates.article_1!.publication.x!.status, 'uncertain'); assert.equal(posts, 0); assert.equal(isWorkerCandidateComplete(state.candidates.article_1!), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('live uses governed fixture data for the Poster caption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-poster-'));
  try {
    const calls: string[][] = [];
    await runNgestWorkerCycle({
      store: new WorkerStateStore(root), mode: 'live', processExisting: true, maxCandidates: 1, now: at, fetchManifest: async () => validManifest(),
      runners: {
        evaluate: async () => evaluation('admitted'), generate: async () => artifact(),
        ...createPosterRunners(async (arguments_) => { calls.push([...arguments_]); if (arguments_[0] === 'doctor' && arguments_[1] !== 'x') throw new Error('not ready'); }),
      },
    });
    assert.deepEqual(calls.at(-1), ['post', 'x', '--video', 'C:/worker/article_1.mp4', '--text', '"First governed headline" by Publisher Main']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only a persisted qualified Web Momentum admission can start generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-qualified-'));
  try {
    const store = new WorkerStateStore(root); let generated = 0;
    const candidate = createDiscoveredCandidate('article_1', at().toISOString());
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: {
      article_1: { ...candidate, evaluation: { status: 'succeeded', completedAt: at().toISOString() }, admission: { status: 'succeeded', completedAt: at().toISOString() }, evaluationResult: { ...evaluation('admitted'), policyId: 'unqualified-policy' } },
    } });
    const state = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1'], mode: 'generate', maxCandidates: 1, now: at, runners: { generate: async () => { generated += 1; return artifact(); } } });
    assert.equal(state.candidates.article_1!.generation.status, 'pending'); assert.equal(generated, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the selected evaluation pass completes before score-priority generation starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const events: string[] = [];
    await runWorkerCycle({
      store: new WorkerStateStore(root), discoveredCandidateIds: ['earlier-low', 'later-high'], mode: 'generate', processExisting: true, maxCandidates: 2, now: at, dailyGenerationLimit: 2,
      runners: {
        evaluate: async (id) => { events.push(`evaluate:${id}`); return scoredEvaluation(id === 'earlier-low' ? 10 : 90); },
        generate: async (id) => { events.push(`generate:${id}`); return artifact(id); },
      },
    });
    assert.deepEqual(events, ['evaluate:earlier-low', 'evaluate:later-high', 'generate:later-high', 'generate:earlier-low']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a newly admitted higher score reprioritizes the durable generation backlog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const store = new WorkerStateStore(root); const generated: string[] = [];
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: { existing_low: admittedCandidate('existing_low', 10, '2026-09-08T11:00:00.000Z') } });
    await runWorkerCycle({
      store, discoveredCandidateIds: ['new_high'], mode: 'generate', maxCandidates: 1, now: at, dailyGenerationLimit: 2,
      runners: { evaluate: async () => scoredEvaluation(90), generate: async (id) => { generated.push(id); return artifact(id); } },
    });
    assert.deepEqual(generated, ['new_high', 'existing_low']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('score-priority ties use admission time then Article ID deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const store = new WorkerStateStore(root); const generated: string[] = [];
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: {
      tie_z: admittedCandidate('tie_z', 50, '2026-09-08T12:00:00.000Z'),
      later: admittedCandidate('later', 50, '2026-09-08T12:01:00.000Z'),
      tie_a: admittedCandidate('tie_a', 50, '2026-09-08T12:00:00.000Z'),
    } });
    await runWorkerCycle({ store, discoveredCandidateIds: [], mode: 'generate', maxCandidates: 1, now: at, dailyGenerationLimit: 3, runners: { generate: async (id) => { generated.push(id); return artifact(id); } } });
    assert.deepEqual(generated, ['tie_a', 'tie_z', 'later']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an admitted backlog entry survives feed disappearance and Worker restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const store = new WorkerStateStore(root); let evaluations = 0; const generated: string[] = [];
    await runWorkerCycle({ store, discoveredCandidateIds: ['gone_from_feed'], mode: 'observe', processExisting: true, maxCandidates: 1, now: at, runners: { evaluate: async () => { evaluations += 1; return scoredEvaluation(70); } } });
    await runWorkerCycle({ store: new WorkerStateStore(root), discoveredCandidateIds: [], mode: 'generate', maxCandidates: 1, now: at, runners: { evaluate: async () => { throw new Error('evaluation must be reused'); }, generate: async (id) => { generated.push(id); return artifact(id); } } });
    assert.equal(evaluations, 1); assert.deepEqual(generated, ['gone_from_feed']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('UTC-day rollover resumes a queued candidate without re-evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const store = new WorkerStateStore(root); const generated: string[] = []; let evaluations = 0;
    const runners = { evaluate: async (id: string) => { evaluations += 1; return scoredEvaluation(id === 'today' ? 90 : 10); }, generate: async (id: string) => { generated.push(id); return artifact(id); } };
    const first = await runWorkerCycle({ store, discoveredCandidateIds: ['today', 'tomorrow'], mode: 'generate', processExisting: true, maxCandidates: 2, now: at, dailyGenerationLimit: 1, runners });
    assert.equal(first.candidates.tomorrow!.generation.block, 'generation_daily_limit'); assert.deepEqual(generated, ['today']);
    const tomorrow = () => new Date('2026-09-09T12:00:00.000Z');
    const resumed = await runWorkerCycle({ store, discoveredCandidateIds: [], mode: 'generate', maxCandidates: 1, now: tomorrow, dailyGenerationLimit: 1, runners: { evaluate: async () => { throw new Error('evaluation must be reused'); }, generate: runners.generate } });
    assert.equal(evaluations, 2); assert.equal(resumed.candidates.tomorrow!.generation.status, 'succeeded'); assert.deepEqual(generated, ['today', 'tomorrow']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an attempt-exhausted high score does not block lower-ranked eligible work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-queue-'));
  try {
    const store = new WorkerStateStore(root); const generated: string[] = [];
    await store.save({ ...emptyWorkerState(), initialized: true, candidates: {
      exhausted: { ...admittedCandidate('exhausted', 90, at().toISOString()), generationAttempts: 2, generation: { status: 'failed', completedAt: at().toISOString(), failure: { code: 'stage_failed', message: 'Worker stage failed.' } } },
      lower: admittedCandidate('lower', 10, at().toISOString()),
    } });
    const state = await runWorkerCycle({ store, discoveredCandidateIds: [], mode: 'generate', maxCandidates: 1, now: at, dailyGenerationLimit: 2, generationAttemptLimit: 2, runners: { generate: async (id) => { generated.push(id); return artifact(id); } } });
    assert.equal(state.candidates.exhausted!.generation.block, 'generation_attempt_limit'); assert.deepEqual(generated, ['lower']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('headline handoff uses exact shell-free argv, accepts only bounded final_ready output, and rechecks files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-headline-'));
  try {
    const finalPath = join(root, 'clip.mp4'); const metadataPath = join(root, 'clip.json'); const bytes = Buffer.from('final media'); const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(finalPath, bytes); await writeFile(metadataPath, '{}');
    let command = ''; let args: readonly string[] = []; let options: unknown;
    const result = await runHeadlineHandoff({ candidateId: 'article_1', fixturePath: 'fixture; $(unsafe).json', artifactsRoot: root, anchorReferencePaths: ['anchor; $HOME.png', 'quote & image.png'], fontPath: 'font; $(unsafe).ttf', maxSeconds: 8 }, {
      spawn: (receivedCommand, receivedArgs, receivedOptions) => {
        command = receivedCommand; args = receivedArgs; options = receivedOptions;
        return child(`Headline clip is final_ready.\nfinal: ${finalPath}\nmetadata: ${metadataPath}\nsha256: ${sha256}\ndurationSeconds: 8\n`);
      },
    });
    assert.equal(command, process.execPath); assert.deepEqual(args, ['--env-file-if-exists=.env', 'src/cli.ts', 'headline', '--input-file', 'fixture; $(unsafe).json', '--article-id', 'article_1', '--anchor-reference', 'anchor; $HOME.png', '--anchor-reference', 'quote & image.png', '--font-file', 'font; $(unsafe).ttf', '--max-seconds', '8', '--artifacts-root', root]);
    assert.deepEqual(options, { cwd: process.cwd(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); assert.deepEqual(result, { finalPath, metadataPath, sha256, durationSeconds: 8 });
    await writeFile(finalPath, 'changed');
    await assert.rejects(runHeadlineHandoff({ candidateId: 'article_1', fixturePath: 'fixture.json', artifactsRoot: root, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf', maxSeconds: 8 }, { spawn: () => child(`Headline clip is final_ready.\nfinal: ${finalPath}\nmetadata: ${metadataPath}\nsha256: ${sha256}\ndurationSeconds: 8\n`) }), /hash could not be verified/);
    assert.throws(() => parseHeadlineSuccessOutput(`Headline clip is final_ready.\nfinal: ${finalPath}\nfinal: ${finalPath}\nmetadata: ${metadataPath}\nsha256: ${sha256}\ndurationSeconds: 8\n`), /unrecognized result/);
    assert.throws(() => parseHeadlineSuccessOutput(`Headline clip is final_ready.\nfinal: ${finalPath}\nmetadata: ${metadataPath}\nsha256: ${sha256}\ndurationSeconds: 8\nextra\n`), /unrecognized result/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generation budgets bound spending while successful verified media is reused and interrupted work stays blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vidgen-worker-generation-'));
  try {
    const store = new WorkerStateStore(root); let calls = 0;
    const artifacts = new Map<string, { finalPath: string; metadataPath: string; sha256: string; durationSeconds: number }>();
    const runners = { evaluate: async () => evaluation('admitted'), generate: async (id: string) => {
      calls += 1; const finalPath = join(root, `${id}.mp4`); const metadataPath = join(root, `${id}.json`); const bytes = Buffer.from(id); const sha256 = createHash('sha256').update(bytes).digest('hex'); await writeFile(finalPath, bytes); await writeFile(metadataPath, '{}');
      const result = await runHeadlineHandoff({ candidateId: id, fixturePath: 'fixture.json', artifactsRoot: root, anchorReferencePaths: ['anchor.png'], fontPath: 'font.ttf', maxSeconds: 8 }, { spawn: () => child(`Headline clip is final_ready.\nfinal: ${finalPath}\nmetadata: ${metadataPath}\nsha256: ${sha256}\ndurationSeconds: 8\n`) }); artifacts.set(id, result); return result;
    }, publish: async () => { throw new Error('Poster must not run.'); } };
    const first = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'generate', processExisting: true, maxCandidates: 2, now: at, dailyGenerationLimit: 1, generationAttemptLimit: 2, runners });
    assert.equal(calls, 1); assert.equal(first.candidates.article_1!.generation.status, 'succeeded'); assert.deepEqual(first.candidates.article_1!.generatedArtifact, artifacts.get('article_1')); assert.equal(first.candidates.article_2!.generation.status, 'blocked'); assert.equal(first.candidates.article_2!.generation.block, 'generation_daily_limit');
    const reused = await runWorkerCycle({ store, discoveredCandidateIds: ['article_1', 'article_2'], mode: 'generate', maxCandidates: 2, now: at, dailyGenerationLimit: 1, generationAttemptLimit: 2, runners });
    assert.equal(calls, 1); assert.equal(reused.candidates.article_1!.generationAttempts, 1);

    const restartStore = new WorkerStateStore(join(root, 'restart'));
    await restartStore.save({ ...emptyWorkerState(), initialized: true, candidates: { article_3: { ...createDiscoveredCandidate('article_3', at().toISOString()), evaluation: { status: 'succeeded', completedAt: at().toISOString() }, admission: { status: 'succeeded', completedAt: at().toISOString() }, evaluationResult: evaluation('admitted'), generation: { status: 'running', startedAt: at().toISOString() } } } });
    const restarted = await runWorkerCycle({ store: restartStore, discoveredCandidateIds: ['article_3'], mode: 'generate', maxCandidates: 1, now: at, runners });
    assert.equal(restarted.candidates.article_3!.generation.status, 'uncertain'); assert.equal(calls, 1);

    const retryStore = new WorkerStateStore(join(root, 'retry')); let failures = 0;
    const retry = { evaluate: async () => evaluation('admitted'), generate: async () => { failures += 1; throw new Error('definite failure'); } };
    for (let index = 0; index < 3; index += 1) await runWorkerCycle({ store: retryStore, discoveredCandidateIds: ['article_4'], mode: 'generate', processExisting: true, maxCandidates: 1, now: at, dailyGenerationLimit: 10, generationAttemptLimit: 2, runners: retry });
    const retried = await retryStore.load(); assert.equal(failures, 2); assert.equal(retried.candidates.article_4!.generation.status, 'blocked'); assert.equal(retried.candidates.article_4!.generation.block, 'generation_attempt_limit');
  } finally { await rm(root, { recursive: true, force: true }); }
});

function evaluation(decision: 'admitted' | 'skipped') { return { metric: 'web-momentum', version: 'v1', policyId: WEB_MOMENTUM_POLICY_ID, score: 3, threshold: 2, decision, evaluatedAt: at().toISOString(), searchId: 'search-1', sessionId: 'session-1', signature: ['article', 'headline'], results: [], components: { breadth: 0, saturation: 3, freshness: 0, reaction: 0 } } as const; }
function scoredEvaluation(score: number, evaluatedAt = at().toISOString()) { return { ...evaluation('admitted'), score, evaluatedAt }; }
function admittedCandidate(id: string, score: number, admittedAt: string) { return { ...createDiscoveredCandidate(id, admittedAt), evaluation: { status: 'succeeded' as const, completedAt: admittedAt }, admission: { status: 'succeeded' as const, completedAt: admittedAt }, evaluationResult: scoredEvaluation(score, admittedAt) }; }
function artifact(id = 'article_1') { return { finalPath: `C:/worker/${id}.mp4`, metadataPath: `C:/worker/${id}.json`, sha256: 'a'.repeat(64), durationSeconds: 8 }; }
function child(output: string) {
  const result = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill(): boolean; };
  result.stdout = new EventEmitter(); result.kill = () => true;
  queueMicrotask(() => { result.stdout.emit('data', Buffer.from(output)); result.emit('close', 0); });
  return result;
}
