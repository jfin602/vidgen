import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseFfprobeJson, parseFrameRate, probeLocalMedia } from '../../../src/integrations/ffmpeg/ffprobe.ts';
import { identifyLocalFile } from '../../../src/integrations/ffmpeg/local-file.ts';
import { VidGenError } from '../../../src/core/error.ts';

test('FFprobe uses an argv array, no shell, and file-only protocol posture', async () => {
  await withFile(async (path) => {
    let call: any;
    const facts = await probeLocalMedia(path, {
      executable: 'fake-ffprobe',
      spawn: (command, args, options) => {
        call = { command, args, options };
        return child(jsonFacts()) as any;
      },
    });
    assert.equal(call.command, 'fake-ffprobe');
    assert.equal(call.options.shell, false);
    assert.deepEqual(call.args.slice(0, 5), ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries']);
    assert.equal(call.args.at(-1), path);
    assert.equal(facts.video?.averageFrameRate.value, 30);
  });
});

test('FFprobe parser bounds rational values and rejects malformed stream facts safely', () => {
  assert.deepEqual(parseFrameRate('30000/1001'), { numerator: 30000, denominator: 1001, value: 30000 / 1001 });
  for (const value of ['0/1', '30/0', '30', '1/9999999999', '999999999/1']) {
    assert.throws(() => parseFrameRate(value), hasAssemblyCode);
  }
  assert.throws(() => parseFfprobeJson('{'), hasAssemblyCode);
  assert.throws(() => parseFfprobeJson(JSON.stringify({ format: { format_name: 'mp4', duration: '4' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1, height: 1, pix_fmt: 'yuv420p', avg_frame_rate: '0/0' }] })), hasAssemblyCode);
});

test('FFprobe failures from timeout, exit status, or bounded output are safe', async () => {
  await withFile(async (path) => {
    await assert.rejects(probeLocalMedia(path, { timeoutMs: 5, spawn: () => silentChild() as any }), hasAssemblyCode);
    await assert.rejects(probeLocalMedia(path, { spawn: () => child('', '', 1) as any }), hasAssemblyCode);
    await assert.rejects(probeLocalMedia(path, { maxStdoutBytes: 2, spawn: () => child(jsonFacts()) as any }), hasAssemblyCode);
    await assert.rejects(probeLocalMedia(path, { maxStderrBytes: 2, spawn: () => child(jsonFacts(), 'too much diagnostic output') as any }), hasAssemblyCode);
  });
});

test('local identity rejects URLs, directories, and bounded oversized files', async () => {
  await withFile(async (path, directory) => {
    await assert.rejects(identifyLocalFile('https://example.invalid/video.mp4'), hasAssemblyCode);
    await assert.rejects(identifyLocalFile(directory), hasAssemblyCode);
    await writeFile(path, Buffer.alloc(8));
    await assert.rejects(identifyLocalFile(path, { maxBytes: 4 }), hasAssemblyCode);
  });
});

function jsonFacts() { return JSON.stringify({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.0' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, pix_fmt: 'yuv420p', avg_frame_rate: '30/1' }] }); }
function child(stdoutText: string, stderrText = '', code = 0) {
  const emitter = new EventEmitter() as any;
  emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => true;
  process.nextTick(() => { if (stdoutText) emitter.stdout.end(stdoutText); else emitter.stdout.end(); if (stderrText) emitter.stderr.end(stderrText); else emitter.stderr.end(); emitter.emit('close', code); });
  return emitter;
}
function silentChild() { const emitter = new EventEmitter() as any; emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => true; return emitter; }
function hasAssemblyCode(error: unknown): boolean { return error instanceof VidGenError && error.code === 'assembly'; }
async function withFile(run: (path: string, directory: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-ffprobe-')); const path = join(directory, 'input.mp4'); try { await mkdir(directory, { recursive: true }); await writeFile(path, Buffer.from('video')); await run(path, directory); } finally { await rm(directory, { recursive: true, force: true }); } }
