import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
        reject(new Error(`Failed to parse JSON from ${cmd}: ${out.slice(0, 300)}`));
      }
    });
  });
}

export async function transcribeUrl(url: string, model = "base") {
  const tmp = await mkdtemp(path.join(tmpdir(), "recipe-ripper-"));
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "transcribe.py");
    const pythonBin =
      process.env.PYTHON_BIN || path.join(process.cwd(), ".venv", "bin", "python");
    const ytdlpBin = process.env.YTDLP_BIN || "yt-dlp";

    await run(ytdlpBin, [
      "--no-playlist",
      "--extractor-args",
      "youtube:player_client=android",
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
      language: result?.language ?? null,
      text: typeof result?.text === "string" ? result.text : "",
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

