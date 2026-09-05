import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import {
  CANONICAL_INPUT_ARTIFACT_NAME,
  createFilesystemArtifactStore,
  runPhase1Input,
  writeJsonAtomically,
} from '../../../src/app/phase-1-input-run.ts';
import { buildCanonicalInput, fingerprintCanonicalInput } from '../../../src/core/canonical-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

const bearerSentinel = 'vidgen-phase-1-bearer-sentinel';

test('CLI persists one safe, validated CanonicalInput under its artifacts-root override', async () => {
  const root = await makeTemporaryDirectory();
  let authorization: string | undefined;
  try {
    await withServer((request, response) => {
      authorization = request.headers.authorization;
      const manifest = validManifest() as unknown as Record<string, unknown>;
      manifest.bearerToken = bearerSentinel;
      sendJson(response, manifest);
    }, async (endpoint) => {
      const result = await runCliProcess(root, endpoint);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Run [a-f0-9-]+ is input_ready\./);
      assert.match(result.stdout, /inputFingerprint: [a-f0-9]{64}/);
      assert.equal(result.stdout.includes(bearerSentinel), false);
      assert.equal(result.stderr.includes(bearerSentinel), false);

      const [runId] = await readdir(root);
      assert.ok(runId);
      const runDirectory = join(root, runId);
      const metadata = await readJson(join(runDirectory, 'run.json'));
      const canonical = await readJson(join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME));

      assert.deepEqual(metadata, {
        runId,
        status: 'input_ready',
        startedAt: metadata.startedAt,
        endedAt: metadata.endedAt,
        engineVersion: '0.2.1',
        inputFingerprint: canonical.inputFingerprint,
        canonicalInputArtifact: CANONICAL_INPUT_ARTIFACT_NAME,
      });
      assert.equal(
        fingerprintCanonicalInput(canonical.feed as never, canonical.control as never),
        canonical.inputFingerprint,
      );
      assert.deepEqual(buildCanonicalInput({
        apiVersion: canonical.provenance.ngestApiVersion,
        profile: canonical.feed.profile,
        publication: canonical.feed.publication,
        articles: canonical.feed.articles,
        control: canonical.control,
        nextCursor: null,
        ...(canonical.provenance.snapshotRevision === undefined
          ? {}
          : { snapshotRevision: canonical.provenance.snapshotRevision }),
      }), canonical);
      assert.match(await readFile(join(runDirectory, 'run.json'), 'utf8'), /\n$/);
      assert.match(await readFile(join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME), 'utf8'), /\n$/);
      assert.equal((await readAllFiles(root)).includes(bearerSentinel), false);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(authorization, `Bearer ${bearerSentinel}`);
});

test('identical canonical input creates separate run directories with separate run IDs', async () => {
  const root = await makeTemporaryDirectory();
  try {
    const first = await runPhase1Input({
      artifactsRoot: root,
      fetchManifest: async () => validManifest(),
      createRunId: () => 'run-first',
      now: fixedClock(),
    });
    const second = await runPhase1Input({
      artifactsRoot: root,
      fetchManifest: async () => validManifest(),
      createRunId: () => 'run-second',
      now: fixedClock(),
    });

    assert.notEqual(first.runId, first.inputFingerprint);
    assert.notEqual(second.runId, second.inputFingerprint);
    assert.notEqual(first.runDirectory, second.runDirectory);
    assert.equal(first.inputFingerprint, second.inputFingerprint);
    assert.deepEqual((await readdir(root)).sort(), ['run-first', 'run-second']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failure after run creation records failed metadata without a canonical artifact', async () => {
  const root = await makeTemporaryDirectory();
  try {
    const store = createFilesystemArtifactStore({
      serializeJson: (value) => {
        if (value !== null && typeof value === 'object' && 'schemaVersion' in value) {
          throw new Error('simulated canonical serialization failure');
        }
        return JSON.stringify(value, null, 2);
      },
      createTemporarySuffix: () => 'test',
    });

    await assert.rejects(
      runPhase1Input({
        artifactsRoot: root,
        fetchManifest: async () => validManifest(),
        createRunId: () => 'run-failure',
        artifactStore: store,
        now: fixedClock(),
      }),
      (error: unknown) => error instanceof VidGenError && error.code === 'artifact',
    );

    const runDirectory = join(root, 'run-failure');
    const metadata = await readJson(join(runDirectory, 'run.json'));
    assert.equal(metadata.status, 'failed');
    assert.equal(metadata.failure.code, 'artifact');
    assert.equal(metadata.canonicalInputArtifact, undefined);
    await assert.rejects(readFile(join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failure publishing terminal input-ready metadata removes the CanonicalInput artifact', async () => {
  const root = await makeTemporaryDirectory();
  try {
    const store = createFilesystemArtifactStore({
      serializeJson: (value) => {
        if (
          value !== null
          && typeof value === 'object'
          && 'status' in value
          && value.status === 'input_ready'
        ) {
          throw new Error('simulated terminal metadata serialization failure');
        }
        return JSON.stringify(value, null, 2);
      },
      createTemporarySuffix: () => 'test',
    });

    await assert.rejects(
      runPhase1Input({
        artifactsRoot: root,
        fetchManifest: async () => validManifest(),
        createRunId: () => 'run-terminal-metadata-failure',
        artifactStore: store,
        now: fixedClock(),
      }),
      (error: unknown) => error instanceof VidGenError && error.code === 'artifact',
    );

    const runDirectory = join(root, 'run-terminal-metadata-failure');
    const metadata = await readJson(join(runDirectory, 'run.json'));
    assert.equal(metadata.status, 'failed');
    assert.equal(metadata.failure.code, 'artifact');
    assert.equal(metadata.canonicalInputArtifact, undefined);
    await assert.rejects(readFile(join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI returns a nonzero status for nextCursor and records a failed run without CanonicalInput', async () => {
  const root = await makeTemporaryDirectory();
  try {
    await withServer((_request, response) => {
      const manifest = validManifest();
      (manifest as unknown as { nextCursor: string }).nextCursor = 'next-page';
      sendJson(response, manifest);
    }, async (endpoint) => {
      const result = await runCliProcess(root, endpoint);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /\[ngest_unsupported_continuation\]/);
      assert.equal(result.stdout.includes(bearerSentinel), false);
      assert.equal(result.stderr.includes(bearerSentinel), false);
    });

    const [runId] = await readdir(root);
    assert.ok(runId);
    const runDirectory = join(root, runId);
    const metadata = await readJson(join(runDirectory, 'run.json'));
    assert.deepEqual(metadata.failure, {
      code: 'ngest_unsupported_continuation',
      message: 'Ngest VidGen manifest continuation is not supported.',
    });
    assert.equal(metadata.status, 'failed');
    await assert.rejects(readFile(join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic JSON writes serialize before creating a temporary or final file', async () => {
  const calls: string[] = [];
  await assert.rejects(
    writeJsonAtomically({
      writeFile: async (path) => { calls.push(`write:${path}`); },
      rename: async (from, to) => { calls.push(`rename:${from}:${to}`); },
      unlink: async (path) => { calls.push(`unlink:${path}`); },
    }, 'final.json', { any: 'value' }, () => {
      throw new Error('serialization failed');
    }, () => 'temporary'),
  );
  assert.deepEqual(calls, []);
});

function fixedClock(): () => Date {
  const dates = [
    new Date('2026-09-05T12:00:00.000Z'),
    new Date('2026-09-05T12:00:01.000Z'),
  ];
  return () => dates.shift() ?? new Date('2026-09-05T12:00:01.000Z');
}

async function makeTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vidgen-phase-1-'));
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function readAllFiles(root: string): Promise<string> {
  const names = await readdir(root);
  return (await Promise.all(names.map(async (name) => {
    const runDirectory = join(root, name);
    const files = await readdir(runDirectory);
    return Promise.all(files.map((file) => readFile(join(runDirectory, file), 'utf8')));
  }))).flat(2).join('\n');
}

async function runCliProcess(artifactsRoot: string, endpoint: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/cli.ts', 'run', '--artifacts-root', artifactsRoot], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NGEST_VIDGEN_URL: endpoint,
        NGEST_VIDGEN_BEARER_TOKEN: bearerSentinel,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (endpoint: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
}

function sendJson(response: ServerResponse, value: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
