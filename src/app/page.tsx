"use client";

import { useMemo, useState } from "react";

type Recipe = {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  notes?: string[];
  sourceUrl?: string;
};

type StepEvent = {
  t?: number;
  step: string;
  msg?: string;
  data?: any;
};

function fmtTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [model, setModel] = useState<"tiny" | "base" | "small" | "medium" | "large-v3">("tiny");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  const [debugMode, setDebugMode] = useState(true);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [rawResponse, setRawResponse] = useState<string>("");

  const canRun = useMemo(() => url.trim().length > 0, [url]);

  const pushStep = (step: string, msg?: string, data?: any) => {
    setSteps((prev) => [...prev, { t: Date.now(), step, msg, data }]);
  };

  async function extract() {
    setError("");
    setRecipe(null);
    setRawResponse("");
    setSteps([]);
    setLoading(true);

    pushStep("client.start", "Starting extraction");

    try {
      pushStep("client.fetch", "POST /api/extract", { url: url.trim(), model });

      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          pastedText,
          whisperModel: model,
          debug: debugMode,
        }),
      });

      pushStep("client.fetch.done", `HTTP ${res.status}`, { ok: res.ok });

      const raw = await res.text();
      setRawResponse(raw);

      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        pushStep("client.parseJson.fail", "Response was not valid JSON", {
          preview: raw.slice(0, 200),
        });
        throw new Error(`Bad JSON from server: ${raw.slice(0, 200)}`);
      }

      // show server-reported steps (super helpful)
      if (Array.isArray(data?.steps)) {
        pushStep("client.mergeServerSteps", "Merging server steps", { count: data.steps.length });
        setSteps((prev) => [...prev, ...data.steps]);
      }

      if (!res.ok) {
        pushStep("client.error", data?.error || `HTTP ${res.status}`, { step: data?.step });
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      setRecipe(data.recipe ?? null);
      pushStep("client.done", "Success");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      pushStep("client.exception", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setUrl("");
    setPastedText("");
    setRecipe(null);
    setError("");
    setSteps([]);
    setRawResponse("");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Recipe Ripper</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Paste a link, optionally add text, then extract a recipe (with step-by-step logging).
          </p>
        </header>

        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
          <div className="space-y-1.5">
            <label className="text-sm text-zinc-300">Video URL</label>
            <input
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-600"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              spellCheck={false}
              inputMode="url"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading && canRun) {
                  e.preventDefault();
                  extract();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-zinc-300">Optional pasted text</label>
            <textarea
              className="min-h-[140px] w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-600"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste captions, ingredient list, etc."
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <label className="text-sm text-zinc-300">Whisper model</label>
              <select
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                value={model}
                onChange={(e) => setModel(e.target.value as any)}
              >
                <option value="tiny">tiny (fastest)</option>
                <option value="base">base</option>
                <option value="small">small</option>
                <option value="medium">medium</option>
                <option value="large-v3">large-v3 (slowest)</option>
              </select>

              <label className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-500"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                  disabled={loading}
                />
                Debug mode (return server steps + errors)
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm hover:border-zinc-700 disabled:opacity-50"
                onClick={reset}
                disabled={loading}
              >
                Reset
              </button>

              <button
                type="button"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
                onClick={extract}
                disabled={loading || !canRun}
              >
                {loading ? "Extracting..." : "Extract recipe"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-900/60 bg-red-950/50 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        {/* Progress / Steps */}
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">Progress</h3>
            <button
              type="button"
              className="text-xs text-zinc-400 underline"
              onClick={() => setSteps([])}
              disabled={loading}
            >
              clear
            </button>
          </div>

          <div className="mt-3 space-y-2 text-xs text-zinc-300">
            {steps.length === 0 ? (
              <p className="text-zinc-400">No steps yet.</p>
            ) : (
              steps.map((s, i) => (
                <div key={i} className="rounded-xl bg-zinc-950 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-zinc-200">{s.step}</span>
                    {typeof s.t === "number" ? (
                      <span className="text-zinc-500">{fmtTime(s.t)}</span>
                    ) : null}
                  </div>
                  {s.msg ? <div className="mt-1 text-zinc-300">{s.msg}</div> : null}
                  {s.data !== undefined ? (
                    <pre className="mt-2 overflow-auto rounded-lg bg-zinc-900/40 p-2 text-[11px] text-zinc-300">
                      {JSON.stringify(s.data, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {rawResponse ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-zinc-400 underline">
                show raw response (first 2k)
              </summary>
              <pre className="mt-2 max-h-[240px] overflow-auto rounded-xl bg-zinc-950 p-3 text-[11px] text-zinc-300">
                {rawResponse.slice(0, 2000)}
              </pre>
            </details>
          ) : null}
        </section>

        {/* Recipe */}
        {recipe ? (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-xl font-semibold">{recipe.title || "Recipe"}</h2>

            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">Ingredients</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                  {(recipe.ingredients || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-medium text-zinc-200">Steps</h3>
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
                  {(recipe.steps || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ol>
              </div>
            </div>

            {(recipe.notes?.length ?? 0) > 0 ? (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-zinc-200">Notes</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                  {(recipe.notes || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {recipe.sourceUrl ? (
              <p className="mt-4 text-xs text-zinc-400">
                Source:{" "}
                <a className="underline" href={recipe.sourceUrl} target="_blank" rel="noreferrer">
                  {recipe.sourceUrl}
                </a>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

