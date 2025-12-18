// src/app/api/extract/route.ts
import { z } from "zod";
import { fetchSourceText } from "@/lib/platform";
import { extractRecipe } from "@/lib/recipe";

export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().url(),
  pastedText: z.string().optional().default(""),
  whisperModel: z.string().optional().default("base"),
  debug: z.boolean().optional().default(false),
});

type StepEvent = {
  t: number; // ms timestamp
  step: string;
  msg?: string;
  data?: any;
};

function now() {
  return Date.now();
}

function shortErr(e: any) {
  return e?.message ?? String(e);
}

export async function POST(req: Request) {
  const steps: StepEvent[] = [];
  const push = (step: string, msg?: string, data?: any) => {
    const ev: StepEvent = { t: now(), step };
    if (msg) ev.msg = msg;
    if (data !== undefined) ev.data = data;
    steps.push(ev);
  };

  let currentStep = "start";

  try {
    currentStep = "parse.body";
    push(currentStep, "Reading request JSON");
    const json = await req.json();

    currentStep = "validate.body";
    push(currentStep, "Validating input schema");
    const { url, pastedText, whisperModel, debug } = BodySchema.parse(json);

    const origin = new URL(req.url).origin;
    push("env", `origin=${origin}`, { runtime: "nodejs" });

    // 1) Platform-native text
    currentStep = "fetchSourceText";
    push(currentStep, "Fetching platform text (transcript/oEmbed/etc)", { url });

    const source = await fetchSourceText(url);
    push("fetchSourceText.done", "Fetched platform result", {
      platform: source?.platform,
      title: source?.title,
      author: source?.author,
      textLen: source?.text?.length ?? 0,
    });

    // 2) Whisper fallback
    let usedWhisper = false;

    let whisperError: string | undefined;
    const minChars = 40;
    const sourceTextLen = (source?.text ?? "").trim().length;

    if (sourceTextLen < minChars) {
      currentStep = "transcribe.fallback";
      push(currentStep, "Platform text insufficient; calling /api/transcribe", {
        sourceTextLen,
        minChars,
        whisperModel,
      });

      try {
        currentStep = "transcribe.fetch";
        const resp = await fetch(`${origin}/api/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, model: whisperModel }),
        });

        push("transcribe.fetch.done", `HTTP ${resp.status}`, { ok: resp.ok });

        currentStep = "transcribe.parse";
        const raw = await resp.text();
        let tr: any = null;
        try {
          tr = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error(`Transcribe returned invalid JSON: ${raw.slice(0, 200)}`);
        }

        if (!resp.ok) {
          whisperError = tr?.error || `Transcribe failed with HTTP ${resp.status}`;
          push("transcribe.error", whisperError, tr);
        } else if (tr?.ok && typeof tr.text === "string" && tr.text.trim()) {
          source.text = tr.text;
          usedWhisper = true;
          push("transcribe.success", "Whisper text applied", { textLen: tr.text.length });
        } else {
          whisperError = "Transcribe returned no text.";
          push("transcribe.empty", whisperError, tr);
        }
      } catch (e: any) {
        whisperError = shortErr(e);
        push("transcribe.exception", whisperError);
      }
    } else {
      push("transcribe.skip", "Platform text sufficient; skipping Whisper", { sourceTextLen });
    }

    // 3) Combine text
    currentStep = "combine.text";
    push(currentStep, "Combining source + pasted text");

    const combinedText = [
      source.title ? `TITLE: ${source.title}` : "",
      source.author ? `AUTHOR: ${source.author}` : "",
      source.text ? `SOURCE TEXT:\n${source.text}` : "",
      pastedText?.trim() ? `PASTED TEXT:\n${pastedText.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    push("combine.text.done", "Combined text built", { combinedLen: combinedText.length });

    if (combinedText.trim().length < minChars) {
      currentStep = "reject.notEnoughText";
      push(currentStep, "Not enough text to extract recipe", {
        minChars,
        combinedLen: combinedText.trim().length,
      });

      return Response.json(
        {
          ok: false,
          step: currentStep,
          error:
            "Not enough text to extract a recipe. Try pasting captions/transcript into the textbox.",
          sourceUsed: source,
          usedWhisper,
          ...(debug ? { whisperError } : {}),
          steps,
        },
        { status: 400 }
      );
    }

    // 4) Extract recipe
    currentStep = "extractRecipe";
    push(currentStep, "Running recipe extraction");

    const recipe = await extractRecipe(combinedText, {
      sourceUrl: url,
      sourceTitle: source.title,
    });

    push("extractRecipe.done", "Recipe extracted", {
      title: recipe?.title,
      ingredients: recipe?.ingredients?.length ?? 0,
      stepsCount: recipe?.steps?.length ?? 0,
    });

    currentStep = "done";
    push(currentStep, "Success");

    return Response.json({
      ok: true,
      recipe,
      sourceUsed: source,
      usedWhisper,
      ...(debug ? { whisperError } : {}),
      steps,
    });
  } catch (err: any) {
    const msg = shortErr(err);
    steps.push({ t: now(), step: "exception", msg, data: { at: currentStep } });

    return Response.json(
      {
        ok: false,
        step: currentStep,
        error: msg,
        steps,
      },
      { status: 400 }
    );
  }
}
