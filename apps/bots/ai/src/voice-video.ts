// Convert generated Cyrene speech + a still artwork frame into a small MP4 so
// Discord's native media player can play it inside a Components V2 container.
// Bounded: one conversion at a time, shallow queue, 300 s audio, 90 s process,
// 8 MiB output, private temp paths, always cleaned up.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const VOICE_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_VIDEO_MAX_SECONDS = 300;
export const VOICE_VIDEO_TIMEOUT_MS = 90_000;
export const VOICE_VIDEO_FPS = 10;
export const VOICE_VIDEO_WIDTH = 720;
export const VOICE_VIDEO_MAX_QUEUE = 2;

const DEFAULT_ART = "/app/assets/cyrene-art.png";

export class VoiceVideoError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "VoiceVideoError";
  }
}

export interface VoiceVideoPaths {
  artPath: string;
  wavPath: string;
  outPath: string;
}

/** Argument array only; no shell, no user text. */
export function buildVoiceVideoArgs(paths: VoiceVideoPaths): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(VOICE_VIDEO_FPS),
    "-i",
    paths.artPath,
    "-i",
    paths.wavPath,
    "-vf",
    `scale=${VOICE_VIDEO_WIDTH}:-2:flags=lanczos,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "stillimage",
    "-crf",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ar",
    "48000",
    "-t",
    String(VOICE_VIDEO_MAX_SECONDS),
    "-shortest",
    "-movflags",
    "+faststart",
    paths.outPath,
  ];
}

/** Duration from a PCM WAV header (RIFF/WAVE fmt+data). Null for non-WAV or invalid input. */
export function parseWavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 12 && body + 12 <= bytes.byteLength) {
      byteRate = view.getUint32(body + 8, true);
    }
    if (id === "data") {
      const dataSize = Math.min(size, bytes.byteLength - body);
      return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Parse `ffmpeg -encoders` output for the two encoders this pipeline needs. */
export function encoderSupport(output: string): { h264: boolean; aac: boolean } {
  return {
    h264: /(^|\s)libx264(\s|$)/m.test(output),
    aac: /(^|\s)aac(\s|$)/m.test(output),
  };
}

let queueDepth = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Serialize conversions; reject when more than MAX_QUEUE are waiting. */
export function withVoiceConversionSlot<T>(task: () => Promise<T>): Promise<T> {
  if (queueDepth >= VOICE_VIDEO_MAX_QUEUE) {
    return Promise.reject(new VoiceVideoError("voice-busy", "Voice conversion queue is full"));
  }
  queueDepth += 1;
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    queueDepth -= 1;
  });
  return run;
}

let encoderProbe: Promise<void> | null = null;

async function ensureEncoders(): Promise<void> {
  if (!encoderProbe) {
    encoderProbe = new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => {
        if (output.length < 200_000) output += String(chunk);
      });
      child.on("error", () => reject(new VoiceVideoError("encoder-probe-failed", "ffmpeg is not available")));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new VoiceVideoError("encoder-probe-failed", `ffmpeg -encoders exited ${code}`));
          return;
        }
        const support = encoderSupport(output);
        if (!support.h264 || !support.aac) {
          reject(new VoiceVideoError("encoder-unavailable", "ffmpeg lacks libx264 or aac"));
          return;
        }
        resolve();
      });
    });
    // A failed probe must not be cached forever after a transient spawn error.
    encoderProbe.catch(() => {
      encoderProbe = null;
    });
  }
  await encoderProbe;
}

async function runFfmpeg(args: string[], timeoutMs = VOICE_VIDEO_TIMEOUT_MS): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let settled = false;
    const finish = (error?: VoiceVideoError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += String(chunk).slice(0, 4096 - stderr.length);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new VoiceVideoError("conversion-timeout", "voice video conversion timed out"));
    }, timeoutMs);
    child.on("error", () => finish(new VoiceVideoError("conversion-failed", "ffmpeg could not be started")));
    child.on("close", (code) => {
      if (code === 0) finish();
      else {
        // Paths and codecs only; user text never reaches filenames or arguments.
        console.error("voice video ffmpeg failed:", stderr.slice(0, 300));
        finish(new VoiceVideoError("conversion-failed", `ffmpeg exited ${code}`));
      }
    });
  });
}

export interface RenderVoiceVideoOptions {
  artPath?: string;
  timeoutMs?: number;
}

/** Returns a playable MP4 buffer; throws VoiceVideoError on every bounded failure. */
export async function renderVoiceVideo(wav: Uint8Array, options: RenderVoiceVideoOptions = {}): Promise<Buffer> {
  if (!wav.byteLength) throw new VoiceVideoError("empty-audio", "no speech audio to convert");
  const duration = parseWavDurationSeconds(wav);
  if (duration !== null && duration > VOICE_VIDEO_MAX_SECONDS) {
    throw new VoiceVideoError("voice-too-long", "speech exceeds the video duration bound");
  }
  const artPath = options.artPath ?? process.env.CYRENE_VOICE_ART ?? DEFAULT_ART;
  const art = await stat(artPath).catch(() => null);
  if (!art?.isFile()) throw new VoiceVideoError("artwork-missing", "Cyrene artwork frame is not available");

  return withVoiceConversionSlot(async () => {
    await ensureEncoders();
    const directory = await mkdtemp(join(tmpdir(), "ei-voice-"));
    const wavPath = join(directory, "speech.wav");
    const outPath = join(directory, "cyrene.mp4");
    try {
      await writeFile(wavPath, wav, { mode: 0o600 });
      await runFfmpeg(buildVoiceVideoArgs({ artPath, wavPath, outPath }), options.timeoutMs);
      const info = await stat(outPath);
      if (!info.size) throw new VoiceVideoError("empty-video", "conversion produced an empty file");
      if (info.size > VOICE_VIDEO_MAX_BYTES) throw new VoiceVideoError("video-too-large", "converted video exceeds the size bound");
      return await readFile(outPath);
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  });
}
