// src/app/api/extract/route.ts
import { z } from "zod";
import { fetchSourceText } from "@/lib/platform";
import { extractRecipe } from "@/lib/recipe";
import { transcribeUrl, type StepEvent } from "@/lib/server/transcribe";

export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().url(),
  pastedText: z.string().optional().default(""),
  whisperModel: z.string().optional().default("tiny"),
  debug: z.boolean().optional().default(false),
});

const MIN_TEXT = 250; // raise this so we don't "succeed" on title-only junk

export async function POST(req: Request) {
  const steps: StepEvent[] = [];
  const push = (step: string, msg?: string, data?: any) =>
    steps.push({ t: Date.now(), step, msg, data });

  try {
    push("extract.start", "Parsing request body");
    const json = await req.json();
    const { url, pastedText, whisperModel, debug } = BodySchema.parse(json);

    push("source.fetch.start", "Fetching platform-native text");
    const source = await fetchSourceText(url);
    push("source.fetch.done", "Fetched platform-native text", {
      platform: source.platform,
      title: source.title,
      textLen: source.text?.length ?? 0,
    });

    let usedWhisper = false;
    let whisperError: string | undefined;

    if (!source.text || source.text.trim().length < MIN_TEXT) {
      try {
        push("transcribe.start", `Running whisper (${whisperModel})`);
        const tr = await transcribeUrl(url, whisperModel, push);
        if (tr.text?.trim()) {
          source.text = tr.text;
          usedWhisper = true;
          push("transcribe.done", "Whisper text set", { textLen: tr.text.length });
        } else {
          whisperError = "Transcribe returned empty text.";
          push("transcribe.empty", whisperError);
        }
      } catch (e: any) {
        whisperError = e?.message ?? "Transcribe failed.";
        push("transcribe.exception", whisperError);
      }
    } else {
      push("transcribe.skip", "Platform text was sufficient");
    }

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

    // If we still don't have enough text, ERROR OUT (don’t pretend success)
    if (combinedText.trim().length < MIN_TEXT) {
      return Response.json(
        {
          ok: false,
          error:
            "Couldn’t get enough transcript text (YouTube transcript empty + Whisper failed). Try a different video, or paste captions.",
          step: "combine.not_enough_text",
          usedWhisper,
          whisperError,
          sourceUsed: source,
          steps: debug ? steps : steps.map((s) => ({ t: s.t, step: s.step, msg: s.msg })),
        },
        { status: 502 }
      );
    }

    push("recipe.extract.start", "Extracting recipe");
    const recipe = await extractRecipe(combinedText, {
      sourceUrl: url,
      sourceTitle: source.title,
    });
    push("recipe.extract.done", "Recipe extracted", {
      ingredients: recipe.ingredients?.length ?? 0,
      steps: recipe.steps?.length ?? 0,
    });

    return Response.json({
      ok: true,
      recipe,
      sourceUsed: source,
      usedWhisper,
      whisperError: whisperError ?? null,
      steps: debug ? steps : steps.map((s) => ({ t: s.t, step: s.step, msg: s.msg })),
    });
  } catch (err: any) {
    push("extract.error", err?.message ?? "Unknown error");
    return Response.json(
      {
        ok: false,
        error: err?.message ?? "Unknown error",
        steps: steps.map((s) => ({ t: s.t, step: s.step, msg: s.msg })),
      },
      { status: 400 }
    );
  }
}

