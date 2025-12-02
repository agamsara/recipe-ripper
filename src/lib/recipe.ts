export type Recipe = {
  title: string;
  servings?: string;
  time?: string;
  ingredients: string[];
  steps: string[];
  notes?: string[];
  equipment?: string[];
  sourceUrl?: string;
};

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((x) => clean(x)).filter(Boolean)));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+|(?:\s*[-–•]\s+)/g)
    .map(clean)
    .filter((s) => s.length >= 3);
}

function guessTitle(fullText: string, fallback = "Recipe") {
  const m = fullText.match(/TITLE:\s*(.+)/i);
  if (m?.[1]) return clean(m[1]).slice(0, 80);
  const first = splitSentences(fullText)[0];
  return (first?.slice(0, 80) || fallback).replace(/^SOURCE TEXT:\s*/i, "");
}
function extractIngredientCandidates(text: string): string[] {
  // 1) Prefer explicit "ingredients" section if present
  const ingredientsSection =
    text.match(/ingredients?\s*[:\n]+([\s\S]{0,3000})/i)?.[1] ?? "";

  const sectionLines = ingredientsSection
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && s.length < 120);

  const likelyIngredientLine = (s: string) =>
    !/^(step|steps|method|directions|instructions|notes?)\b/i.test(s) &&
    !/\bsubscribe|like|follow\b/i.test(s) &&
    /[a-z]/i.test(s);

  const fromSection = sectionLines
    .filter(likelyIngredientLine)
    .slice(0, 40);

  // 2) Quantity+unit pattern anywhere (your original approach)
  const units =
    "(tsp|tbsp|teaspoon|tablespoon|cup|cups|oz|ounce|ounces|lb|pound|pounds|g|gram|grams|kg|ml|l|liter|litre|clove|cloves|pinch|dash|slice|slices)";
  const qty = "(?:\\d+(?:\\.\\d+)?|\\d+\\/\\d+)";
  const pattern = new RegExp(
    `\\b${qty}\\s*(?:-\\s*${qty}\\s*)?(?:\\s*(?:x|×)\\s*${qty}\\s*)?(?:\\s*${units})?\\s+[a-z][^.!?\\n]{0,60}`,
    "gi"
  );

  const hits = text.match(pattern) || [];
  const filtered = hits.filter(
    (h) => !/\b(minutes?|seconds?|degrees?|°f|°c)\b/i.test(h)
  );

  return uniq([...fromSection, ...filtered]).slice(0, 40);
}
function extractSteps(text: string): string[] {
  const sentences = splitSentences(text);
  const keep = sentences.filter((s) =>
    /\b(add|mix|stir|whisk|cook|bake|fry|saute|sauté|boil|simmer|chop|slice|mince|combine|blend|serve|fold|pour|season|heat|preheat)\b/i.test(
      s
    )
  );

  const steps = (keep.length ? keep : sentences).slice(0, 18);
  return uniq(steps).map((s, i) => `${i + 1}. ${s}`);
}

// placeholder – you can plug an LLM here later
async function maybeUseLLM(_fullText: string): Promise<Recipe | null> {
  return null;
}

export async function extractRecipe(
  fullText: string,
  opts?: { sourceUrl?: string; sourceTitle?: string }
): Promise<Recipe> {
  const llm = await maybeUseLLM(fullText);
  if (llm) return llm;

  const title = opts?.sourceTitle || guessTitle(fullText);

  const ingredients = extractIngredientCandidates(fullText);
  const steps = extractSteps(fullText);

  const notes: string[] = [];
  if (!ingredients.length)
    notes.push(
      "No clear ingredient list found — consider pasting captions/transcript."
    );
  if (!steps.length)
    notes.push(
      "No clear steps found — consider pasting captions/transcript."
    );

  return {
    title,
    ingredients,
    steps,
    notes: notes.length ? notes : undefined,
    sourceUrl: opts?.sourceUrl,
  };
}
