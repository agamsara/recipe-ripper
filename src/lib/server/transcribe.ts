// src/lib/server/transcribe.ts
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type StepEvent = { t: number; step: string; msg?: string; data?: any };
export type PushStep = (step: string, msg?: string, data?: any) => void;

function run(cmd: string, args: string[], push?: PushStep) {
  return new Promise<void>((resolve, reject) => {
    push?.("exec.start", `${cmd} ${args.join(" ")}`);

    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("error", (e) => reject(e));
    p.on("close", (code) => {
      if (code === 0) {
        push?.("exec.done", `${cmd} OK`);
        resolve();
      } else {
        const msg = `${cmd} failed (${code}). ${stderr.slice(0, 800)}`;
        push?.("exec.fail", msg);
        reject(new Error(msg));
      }
    });
  });
}

function runJson(cmd: string, args: string[], push?: PushStep) {
  return new Promise<any>((resolve, reject) => {
    push?.("execjson.start", `${cmd} ${args.join(" ")}`);

    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));

    p.on("error", (e) => reject(e));
    p.on("close", (code) => {
      if (code !== 0) {
        const msg = `${cmd} failed (${code}). ${err.slice(0, 800)}`;
        push?.("execjson.fail", msg);
        return reject(new Error(msg));
      }
      try {
        const json = JSON.parse(out);
        push?.("execjson.done", `${cmd} JSON OK`, { keys: Object.keys(json || {}) });
        resolve(json);
      } catch {
        const msg = `Failed to parse JSON from ${cmd}. Output: ${out.slice(0, 500)}`;
        push?.("execjson.badjson", msg);
        reject(new Error(msg));
      }
    });
  });
}

export async function transcribeUrl(
  url: string,
  model: string,
  push?: PushStep
): Promise<{ language?: string; text: string }> {
  const tmp = await mkdtemp(path.join(tmpdir(), "cookclip-"));

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");

    const pythonBin =
      process.env.PYTHON_BIN || path.join(process.cwd(), ".venv", "bin", "python");

    const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";

    push?.("transcribe.dl.start", "Downloading audio with yt-dlp");

    // Optional: cap how much audio we download (helps long videos)
    // Set MAX_AUDIO_MINUTES=8 in env if you want.
    const maxMin = Number(process.env.MAX_AUDIO_MINUTES || "0");
    const downloadSections =
      Number.isFinite(maxMin) && maxMin > 0
        ? ["--download-sections", `*00:00-${String(maxMin).padStart(2, "0")}:00`]
        : [];

    await run(
      ytdlpBin,
      [
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
      ],
      push
    );

    const wavPath = path.join(tmp, "audio.wav");
    push?.("transcribe.whisper.start", `Running whisper (${model})`);

    const result = await runJson(pythonBin, [scriptPath, wavPath, model], push);

    const text = typeof result?.text === "string" ? result.text : "";
    const language = typeof result?.language === "string" ? result.language : undefined;

    push?.("transcribe.whisper.done", "Whisper done", { language, textLen: text.length });

    return { language, text };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

