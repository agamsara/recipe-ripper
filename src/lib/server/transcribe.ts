// src/lib/server/transcribe.ts
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type TranscribeResult = {
  language: string;
  text: string;
};

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} failed (${code}): ${stderr}`));
    });
  });
}

function runJson(cmd: string, args: string[]) {
  return new Promise<any>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${cmd} failed (${code}): ${err}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`Failed to parse JSON from ${cmd}. Output: ${out.slice(0, 250)}`));
      }
    });
  });
}

/**
 * Downloads audio from the URL -> wav -> runs scripts/transcribe.py (faster-whisper)
 */
export async function transcribeUrl(url: string, model: string): Promise<TranscribeResult> {
  const tmp = await mkdtemp(path.join(tmpdir(), "cookclip-"));

  try {
    // Make paths absolute + stable regardless of cwd quirks
    const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");

    // Prefer venv python if present
    const pythonBin =
      process.env.PYTHON_BIN || path.join(process.cwd(), ".venv", "bin", "python");

    const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";

    // Optional: cap downloaded audio to first N seconds to speed up long videos
    // Example: MAX_AUDIO_SECONDS=480 (8 minutes)
    const maxSec = Number(process.env.MAX_AUDIO_SECONDS || "0");
    const downloadSections =
      maxSec > 0
        ? ["--download-sections", `*00:00:00-00:${String(Math.floor(maxSec / 60)).padStart(2, "0")}:${String(maxSec % 60).padStart(2, "0")}`]
        : [];

    await run(ytdlpBin, [
      "--no-playlist",
      "--extractor-args",
      "youtube:player_client=android",
      ...downloadSections,
      "-x",
      "--audio-format",
      "wav",
      "-o",
      path.join(tmp, "audio.%(ext)s"),
      url,
    ]);

    const wavPath = path.join(tmp, "audio.wav");

    const result = await runJson(pythonBin, [scriptPath, wavPath, model]);

    return {
      language: String(result.language || "unknown"),
      text: String(result.text || ""),
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
