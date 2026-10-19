import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceVideoArgs,
  encoderSupport,
  parseWavDurationSeconds,
  renderVoiceVideo,
  withVoiceConversionSlot,
  VOICE_VIDEO_MAX_SECONDS,
  VOICE_VIDEO_WIDTH,
} from "./voice-video.js";

function wavBytes(seconds = 1, sampleRate = 48000): Uint8Array {
  const dataSize = sampleRate * 2 * seconds;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return new Uint8Array(buffer);
}

test("video arguments are a bounded, shell-free H.264/AAC still-image encode", () => {
  const args = buildVoiceVideoArgs({ artPath: "/app/assets/cyrene-art.png", wavPath: "/tmp/speech.wav", outPath: "/tmp/cyrene.mp4" });
  assert.equal(args[0], "-hide_banner");
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("stillimage"));
  assert.ok(args.includes("+faststart"));
  assert.ok(args.includes("-shortest"));
  assert.ok(args.includes(String(VOICE_VIDEO_MAX_SECONDS)));
  assert.ok(args.join(" ").includes(`scale=${VOICE_VIDEO_WIDTH}`));
  assert.equal(args[args.length - 1], "/tmp/cyrene.mp4");
});

test("WAV duration is derived from the actual byte rate", () => {
  assert.equal(parseWavDurationSeconds(wavBytes(2)), 2);
  assert.equal(parseWavDurationSeconds(new Uint8Array([0, 1, 2, 3])), null);
  assert.equal(parseWavDurationSeconds(new TextEncoder().encode("not a wav file at all")), null);
});

test("encoder probe detects the required codecs", () => {
  const supported = " V....D libx264              H.264\n A....D aac                  AAC";
  assert.deepEqual(encoderSupport(supported), { h264: true, aac: true });
  const unsupported = " V....D mpeg4\n A....D mp3";
  assert.deepEqual(encoderSupport(unsupported), { h264: false, aac: false });
});

test("conversions are serialized and the third admission is rejected", async () => {
  const order: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = withVoiceConversionSlot(async () => {
    order.push("first-start");
    await gate;
    order.push("first-end");
  });
  const second = withVoiceConversionSlot(async () => {
    order.push("second-start");
    order.push("second-end");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"]);
  await assert.rejects(
    () => withVoiceConversionSlot(async () => {}),
    (error: unknown) => (error as { code?: string }).code === "voice-busy",
  );
  release();
  await first;
  await second;
  assert.deepEqual(order, ["first-start", "first-end", "second-start", "second-end"]);
});

test("bounded failures return typed errors without starting a conversion", async () => {
  await assert.rejects(() => renderVoiceVideo(new Uint8Array()), (error: unknown) => (error as { code?: string }).code === "empty-audio");
  await assert.rejects(
    () => renderVoiceVideo(wavBytes(1), { artPath: "/definitely/missing/cyrene-art.png" }),
    (error: unknown) => (error as { code?: string }).code === "artwork-missing",
  );
  const oversized = wavBytes(VOICE_VIDEO_MAX_SECONDS + 1);
  await assert.rejects(
    () => renderVoiceVideo(oversized, { artPath: "/definitely/missing/cyrene-art.png" }),
    (error: unknown) => (error as { code?: string }).code === "voice-too-long",
  );
});
