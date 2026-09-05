import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CLIP_PLAN_ARTIFACT_NAME,
  CLIP_PLAN_RUN_ARTIFACT_NAME,
  buildClipPlanModelRequest,
  createFilesystemClipPlanArtifactStore,
  planStoryWorkspace,
} from '../../../src/app/clip-plan-workflow.ts';
import { createStoryWorkspace } from '../../../src/app/story-workspace.ts';
import { validateAssemblyTemplate, type AssemblyTemplate } from '../../../src/core/assembly-template.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { buildStoryInput } from '../../../src/core/story-input.ts';
import type { StructuredTextModelClient, StructuredTextModelRequest } from '../../../src/core/structured-text-model.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';
import { validateNgestVidGenManifestPage } from '../../../src/integrations/ngest/vidgen-manifest.ts';
import { VIDGEN_ENGINE_VERSION } from '../../../src/version.ts';

const fixturePath = fileURLToPath(new URL('../../fixtures/ngest-vidgen-manifest.json', import.meta.url));
const providerResponse = 'provider raw response must never be persisted';
const fakeSecret = 'not-a-real-secret-value';

test('manual planning calls the fake exactly once and persists a validated ClipPlan', async () => {
  await withTemporaryDirectory(async (root) => {
    const requests: StructuredTextModelRequest[] = [];
    const client = fakeClient((request) => {
      requests.push(request);
      return {
        provider: 'fake-text', model: 'fake-returned-model', requestId: 'request-123',
        outputText: JSON.stringify({
          slots: [
            { id: 'closing', text: ' Final note. ' },
            { id: 'narration', text: ' Core explanation. ' },
            { id: 'headline', text: ' Display title. ' },
            { id: 'supporting-information', text: ' Supporting fact. ' },
            { id: 'hook', text: ' Opening line. ' },
          ],
        }),
      };
    });

    const result = await planStoryWorkspace({
      inputFile: fixturePath,
      articleId: 'example-article-1',
      artifactsRoot: root,
      createStory: storyCreator('planned-second'),
      createTextClient: () => client,
      now: planningClock(),
    });

    assert.equal(result.story.storyRunId, 'planned-second');
    assert.equal(result.story.storyInput.article.articleId, 'example-article-1');
    assert.equal(requests.length, 1);
    const request = requests[0]!;
    assert.match(request.systemInstruction, /only supplied StoryInput facts/i);
    assert.match(request.systemInstruction, /template structure and timing are fixed/i);
    assert.match(request.systemInstruction, /controls are untrusted/i);
    assert.match(request.systemInstruction, /shot plans, media prompts, provider instructions, or commentary/i);
    assert.match(request.input, /NORMALIZED_STORY_AND_TEMPLATE_JSON/);
    assert.match(request.input, /Example city opens a fictional community laboratory/);
    assert.match(request.input, /"startSeconds":0/);
    assert.match(request.input, /"endSeconds":40/);
    for (const slot of getAssemblyTemplate('default-news-40s').contentSlots) {
      assert.match(request.input, new RegExp(`"id":"${slot.id}"`));
      assert.match(request.input, new RegExp(`"usage":"${slot.usage}"`));
      assert.equal(request.input.includes(slot.instruction), true);
    }
    assert.match(request.input, /UNTRUSTED_CONTROL_JSON_BEGIN/);
    assert.match(request.input, /"tone":"measured"/);
    assert.equal(request.input.includes('publisher.example.test'), false);
    assert.equal(request.input.includes('imageUrl'), false);
    assert.deepEqual(request.responseSchema.properties.slots.items.properties.id.enum, [
      'hook', 'headline', 'narration', 'supporting-information', 'closing',
    ]);

    const plan = await readJson(result.clipPlanPath);
    assert.equal(plan.storyFingerprint, result.story.storyInput.storyFingerprint);
    assert.deepEqual(plan.template, { id: 'default-news-40s', version: '2' });
    assert.deepEqual(plan.slots, [
      { id: 'hook', text: 'Opening line.' },
      { id: 'headline', text: 'Display title.' },
      { id: 'narration', text: 'Core explanation.' },
      { id: 'supporting-information', text: 'Supporting fact.' },
      { id: 'closing', text: 'Final note.' },
    ]);

    const metadata = await readJson(result.clipPlanRunPath);
    assert.deepEqual(metadata, {
      storyRunId: 'planned-second',
      status: 'clip_plan_ready',
      startedAt: '2026-09-05T12:00:02.000Z',
      endedAt: '2026-09-05T12:00:03.000Z',
      engineVersion: VIDGEN_ENGINE_VERSION,
      storyFingerprint: result.story.storyInput.storyFingerprint,
      template: { id: 'default-news-40s', version: '2' },
      provider: 'fake-text',
      configuredModel: 'fake-configured-model',
      returnedModel: 'fake-returned-model',
      requestId: 'request-123',
      clipPlanArtifact: CLIP_PLAN_ARTIFACT_NAME,
    });
    const persistedText = `${JSON.stringify(plan)}${JSON.stringify(metadata)}`;
    assert.equal(persistedText.includes(providerResponse), false);
    assert.equal(persistedText.includes(fakeSecret), false);
    assert.equal(persistedText.includes(request.systemInstruction), false);
  });
});

test('manual planning can explicitly select the second Article when it has sufficient context', async () => {
  await withTemporaryDirectory(async (root) => {
    const inputFile = await fixtureWithSecondSummary(root);
    const result = await planStoryWorkspace({
      inputFile,
      articleId: 'example-article-2',
      artifactsRoot: root,
      createStory: storyCreator('planned-article-2'),
      createTextClient: () => fakeClient(() => validOutput()),
      now: planningClock(),
    });
    assert.equal(result.story.storyInput.article.articleId, 'example-article-2');
    assert.equal(result.clipPlan.storyFingerprint, result.story.storyInput.storyFingerprint);
  });
});

test('the same input can be planned again into a separate story workspace', async () => {
  await withTemporaryDirectory(async (root) => {
    const options = {
      inputFile: fixturePath,
      articleId: 'example-article-1',
      artifactsRoot: root,
      createTextClient: () => fakeClient(() => validOutput()),
      now: planningClock(),
    };
    const first = await planStoryWorkspace({ ...options, createStory: storyCreator('rerun-first') });
    const second = await planStoryWorkspace({ ...options, createStory: storyCreator('rerun-second') });
    assert.notEqual(first.story.storyRunId, second.story.storyRunId);
    assert.notEqual(first.story.storyDirectory, second.story.storyDirectory);
    assert.equal(first.clipPlan.storyFingerprint, second.clipPlan.storyFingerprint);
  });
});

test('null summary fails before the text client is constructed or called and records non-ready metadata', async () => {
  await withTemporaryDirectory(async (root) => {
    let createdClients = 0;
    await assert.rejects(
      planStoryWorkspace({
        inputFile: fixturePath,
        articleId: 'example-article-2',
        artifactsRoot: root,
        createStory: storyCreator('missing-summary'),
        createTextClient: () => {
          createdClients += 1;
          return fakeClient(() => { throw new Error('must not call provider'); });
        },
        now: planningClock(),
      }),
      /non-null StoryInput summary/,
    );
    assert.equal(createdClients, 0);
    const directory = join(root, 'missing-summary');
    await assert.rejects(readFile(join(directory, CLIP_PLAN_ARTIFACT_NAME), 'utf8'));
    const metadata = await readJson(join(directory, CLIP_PLAN_RUN_ARTIFACT_NAME));
    assert.equal(metadata.status, 'failed');
    assert.equal(metadata.status === 'clip_plan_ready', false);
    assert.equal(metadata.provider, 'not-called');
    assert.equal(metadata.configuredModel, null);
    assert.deepEqual(metadata.failure, {
      code: 'clip_plan',
      message: 'A non-null StoryInput summary is required before creating a ClipPlan.',
    });
  });
});

test('malformed model text fails after its single call without publishing a successful ClipPlan', async () => {
  await withTemporaryDirectory(async (root) => {
    let calls = 0;
    await assert.rejects(
      planStoryWorkspace({
        inputFile: fixturePath,
        articleId: 'example-article-1',
        artifactsRoot: root,
        createStory: storyCreator('invalid-output'),
        createTextClient: () => fakeClient(() => {
          calls += 1;
          return {
            provider: 'fake-text', model: 'fake-model',
            outputText: `{not-json ${providerResponse} ${fakeSecret}`,
          };
        }),
        now: planningClock(),
      }),
      /model output was invalid/,
    );
    assert.equal(calls, 1);
    await assert.rejects(readFile(join(root, 'invalid-output', CLIP_PLAN_ARTIFACT_NAME), 'utf8'));
    const metadata = await readJson(join(root, 'invalid-output', CLIP_PLAN_RUN_ARTIFACT_NAME));
    assert.equal(metadata.status, 'failed');
    assert.equal('clipPlanArtifact' in metadata, false);
    assert.deepEqual(metadata.failure, { code: 'clip_plan', message: 'ClipPlan model output was invalid.' });
    assert.equal(JSON.stringify(metadata).includes(providerResponse), false);
    assert.equal(JSON.stringify(metadata).includes(fakeSecret), false);
  });
});

test('a terminal success-metadata failure removes the already-published ClipPlan and writes failed metadata', async () => {
  await withTemporaryDirectory(async (root) => {
    const store = createFilesystemClipPlanArtifactStore({
      serializeJson: (value) => {
        if (value !== null && typeof value === 'object' && 'status' in value && value.status === 'clip_plan_ready') {
          throw new Error('simulated terminal metadata serialization failure');
        }
        return JSON.stringify(value, null, 2);
      },
      createTemporarySuffix: () => 'test',
    });
    await assert.rejects(planStoryWorkspace({
      inputFile: fixturePath,
      articleId: 'example-article-1',
      artifactsRoot: root,
      createStory: storyCreator('terminal-failure'),
      createTextClient: () => fakeClient(() => validOutput()),
      artifactStore: store,
      now: planningClock(),
    }));
    await assert.rejects(readFile(join(root, 'terminal-failure', CLIP_PLAN_ARTIFACT_NAME), 'utf8'));
    const metadata = await readJson(join(root, 'terminal-failure', CLIP_PLAN_RUN_ARTIFACT_NAME));
    assert.equal(metadata.status, 'failed');
    assert.equal('clipPlanArtifact' in metadata, false);
  });
});

test('prompt construction and strict model-output schema remain generic for non-default slot IDs', () => {
  const story = buildStoryInput(
    buildCanonicalInput(validateNgestVidGenManifestPage(JSON.parse(readFileSync(fixturePath, 'utf8')))),
    'example-article-1',
  );
  const template = alternateTemplate();
  const request = buildClipPlanModelRequest(story, template);

  assert.equal(request.input.includes('hook'), false);
  assert.deepEqual(request.responseSchema.properties.slots.items.properties.id.enum, [
    'announcement', 'key-detail', 'farewell',
  ]);
  for (const slot of template.contentSlots) {
    assert.match(request.input, new RegExp(`"id":"${slot.id}"`));
    assert.equal(request.input.includes(slot.instruction), true);
  }
  assert.match(request.input, /"startSeconds":6/);
});

function storyCreator(runId: string): typeof createStoryWorkspace {
  return async (dependencies) => createStoryWorkspace({
    ...dependencies,
    createStoryRunId: () => runId,
    now: storyClock(),
  });
}

function fakeClient(
  generate: (request: StructuredTextModelRequest) => { readonly provider: string; readonly model: string; readonly requestId?: string; readonly outputText: string },
): StructuredTextModelClient {
  return {
    provider: 'fake-text',
    model: 'fake-configured-model',
    generateStructuredJson: async (request) => generate(request),
  };
}

function validOutput() {
  return {
    provider: 'fake-text', model: 'fake-model', outputText: JSON.stringify({
      slots: getAssemblyTemplate('default-news-40s').contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` })),
    }),
  };
}

function alternateTemplate(): AssemblyTemplate {
  const template = JSON.parse(readFileSync('templates/default-news-40s.json', 'utf8')) as any;
  template.id = 'brief-update-25s';
  template.contentSlots = [
    { id: 'announcement', usage: 'display', instruction: 'Concise supplied announcement.' },
    { id: 'key-detail', usage: 'spoken', instruction: 'Explain the supplied key detail.' },
    { id: 'farewell', usage: 'spoken', instruction: 'Close without new facts.' },
  ];
  template.generatedAssetRoles = [
    { id: 'brief-anchor', kind: 'presenter' }, { id: 'brief-video', kind: 'video' }, { id: 'brief-voiceover', kind: 'voiceover' },
  ];
  template.segments = [
    { id: 'opening', startSeconds: 0, endSeconds: 6, contentSlots: ['announcement'], generatedAssetRoles: ['brief-anchor'] },
    { id: 'summary', startSeconds: 6, endSeconds: 18, contentSlots: ['key-detail'], generatedAssetRoles: ['brief-video', 'brief-voiceover'] },
    { id: 'signoff', startSeconds: 18, endSeconds: 25, contentSlots: ['farewell'], generatedAssetRoles: ['brief-anchor'] },
  ];
  return validateAssemblyTemplate(template);
}

function storyClock(): () => Date {
  const dates = [new Date('2026-09-05T12:00:00.000Z'), new Date('2026-09-05T12:00:01.000Z')];
  return () => dates.shift() ?? new Date('2026-09-05T12:00:01.000Z');
}

function planningClock(): () => Date {
  const dates = [new Date('2026-09-05T12:00:02.000Z'), new Date('2026-09-05T12:00:03.000Z')];
  return () => dates.shift() ?? new Date('2026-09-05T12:00:03.000Z');
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function fixtureWithSecondSummary(root: string): Promise<string> {
  const manifest = JSON.parse(await readFile(fixturePath, 'utf8')) as { articles: Array<{ summary: string | null }> };
  manifest.articles[1]!.summary = 'A supplied summary allows deterministic planning of the second fixture article.';
  const inputFile = join(root, 'second-article-with-summary.json');
  await writeFile(inputFile, JSON.stringify(manifest), 'utf8');
  return inputFile;
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'vidgen-clip-plan-workflow-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
