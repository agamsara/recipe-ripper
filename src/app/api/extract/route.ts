// src/app/api/extract/route.ts
import { z } from "zod";
import { fetchSourceText } from "@/lib/platform";
import { extractRecipe } from "@/lib/recipe";
import { transcribeUrl } from "@/lib/server/transcribe";

export const runtime = "nodejs";

type StepEvent = { t: number; step: string; msg?: string; data?: any };

const BodySchema = z.object({
  url: z.string().url(),
  pastedText: z.string().optional().default(""),
  whisperModel: z.string().optional().default("base"),
  debug: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const steps: StepEvent[] = [];
  const push = (step: string, msg?: string, data?: any) =>
    steps.push({ t: Date.now(), step, msg, data });

  try {
    push("extract.start", "Parsing request body");
    const { url, pastedText, whisperModel, debug } = BodySchema.parse(await req.json());

    push("source.fetch.start", "Fetching platform-native text");
    const source = await fetchSourceText(url);
    push("source.fetch.done", "Fetched platform-native text", {
      platform: source.platform,
      textLen: source.text?.length ?? 0,
      title: source.title,
    });

    let usedWhisper = false;
    let whisperError: string | null = null;

    // Fallback to local whisper if we didn't get enough
    if (!source.text || source.text.trim().length < 40) {
      push("transcribe.start", `Running whisper (${whisperModel})`);
      try {
        const tr = await transcribeUrl(url, whisperModel);

        if (tr.text && tr.text.trim()) {
          source.text = tr.text;
          usedWhisper = true;
          push("transcribe.done", "Whisper transcription ok", { textLen: tr.text.length });
        } else {
          whisperError = "Transcribe returned no text.";
          push("transcribe.error", whisperError);
        }
      } catch (e: any) {
        push("transcribe.exception", whisperError ?? "Transcribe failed.");
        whisperError = e?.message ?? "Transcribe failed.";
      }
    } else {
      push("transcribe.skip", "Platform text was sufficient");
    }

    // Combine text
    push("combine.start", "Combining text sources");
    const combinedText = [
      source.title ? `TITLE: ${source.title}` : "",
      source.author ? `AUTHOR: ${source.author}` : "",
      source.text ? `SOURCE TEXT:\n${source.text}` : "",
      pastedText?.trim() ? `PASTED TEXT:\n${pastedText.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    push("combine.done", "Combined text ready", { combinedLen: combinedText.length });

    if (combinedText.trim().length < 40) {
      push("extract.fail", "Not enough text to extract a recipe");
      return Response.json(
        {
          error:
            "Not enough text to extract a recipe. Try pasting captions/transcript into the textbox.",
          step: "extract.fail",
          steps,
          sourceUsed: debug ? source : { platform: source.platform, title: source.title, author: source.author },
          usedWhisper,
          ...(debug ? { whisperError } : {}),
        },
        { status: 400 }
      );
    }

    // Extract recipe
    push("recipe.extract.start", "Extracting recipe");
    const recipe = await extractRecipe(combinedText, {
      sourceUrl: url,
      sourceTitle: source.title,
    });
    push("recipe.extract.done", "Recipe extracted");

    // Avoid sending huge transcripts unless debug
    const sourceUsed = debug
      ? {
          ...source,
          text: (source.text || "").slice(0, 8000), // keep UI responsive
        }
      : { platform: source.platform, title: source.title, author: source.author };

    return Response.json({
      recipe,
      steps,
      sourceUsed,
      usedWhisper,
      ...(debug ? { whisperError } : {}),
    });
  } catch (err: any) {
    push("extract.exception", err?.message ?? "Unknown error");
    return Response.json(
      {
        error: err?.message ?? "Unknown error",
        step: "extract.exception",
        steps,
      },
      { status: 400 }
    );
  }
}

