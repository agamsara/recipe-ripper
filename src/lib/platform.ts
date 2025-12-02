type SourceText = {
  platform: "youtube" | "tiktok" | "unknown";
  title?: string;
  author?: string;
  text?: string; // transcript/caption/description-ish
};

function detectPlatform(url: string): SourceText["platform"] {
  const u = new URL(url);
  const h = u.hostname.toLowerCase();
  if (h.includes("youtube.com") || h.includes("youtu.be")) return "youtube";
  if (h.includes("tiktok.com")) return "tiktok";
  return "unknown";
}

function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();

    // youtu.be/<id>
    if (h.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    // youtube.com/watch?v=<id>
    const v = u.searchParams.get("v");
    if (v) return v;

    // youtube.com/shorts/<id>
    const parts = u.pathname.split("/").filter(Boolean);
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];

    return null;
  } catch {
    return null;
  }
}
function extractJsonObject(html: string, marker: string): any | null {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  // Find first "{" after marker
  const start = html.indexOf("{", idx);
  if (start === -1) return null;

  // Brace-match to extract a full JSON object
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonText = html.slice(start, i + 1);
          try {
            return JSON.parse(jsonText);
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

function transcriptFromJson3(json3: any): string {
  const events = json3?.events ?? [];
  const parts: string[] = [];

  for (const ev of events) {
    const segs = ev?.segs ?? [];
    for (const s of segs) {
      const t = s?.utf8;
      if (t) parts.push(t);
    }
    parts.push("\n");
  }

  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchYouTubeTranscriptFallback(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const res = await fetch(watchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`watch page fetch failed (${res.status})`);

  const html = await res.text();

  // YouTube embeds this object on the page
  const player = extractJsonObject(html, "ytInitialPlayerResponse");
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error("no captionTracks found (captions may be disabled/restricted)");
  }

  // Prefer English if present, otherwise first track
  const preferred =
    tracks.find((t: any) => (t?.languageCode || "").startsWith("en")) ?? tracks[0];

  const baseUrl = preferred?.baseUrl;
  if (!baseUrl) throw new Error("caption track missing baseUrl");

  // Try JSON3 timedtext (easiest to parse)
  const timedTextUrl = baseUrl.includes("fmt=")
    ? baseUrl
    : `${baseUrl}&fmt=json3`;

    const ccRes = await fetch(timedTextUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!ccRes.ok) throw new Error(`timedtext fetch failed (${ccRes.status})`);

    const json3 = await ccRes.json();
    return transcriptFromJson3(json3);
}


async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

export async function fetchSourceText(url: string): Promise<SourceText> {
  const platform = detectPlatform(url);

  if (platform === "youtube") {
    const videoId = parseYouTubeId(url);
    if (!videoId) return { platform, text: "" };

    let title: string | undefined;
    let author: string | undefined;
    try {
      const oembed = await fetchJson(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      );
        title = oembed?.title;
        author = oembed?.author_name;
    } catch (e: any) {
      console.error("platform.ts error:", e?.message ?? e);
    }

    let text = "";
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const items = await YoutubeTranscript.fetchTranscript(videoId);
      text = items.map((x: any) => x.text).join(" ");
    } catch (e: any) {
      console.error("youtube-transcript failed:", e?.message ?? e);
    }

    // Fallback: scrape caption track URL from the watch page
    if (!text.trim()) {
      try {
        text = await fetchYouTubeTranscriptFallback(videoId);
      } catch (e: any) {
        if (process.env.RECIPE_RIPPER_DEBUG === "1") {
          console.warn("youtube transcript failed (will use whisper):", e?.message ?? e);
        }}
    }

    return { platform, title, author, text };
  }

  if (platform === "tiktok") {
    let title: string | undefined;
    let author: string | undefined;
    let text = "";
    try {
      const oembed = await fetchJson(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      );
        title = oembed?.title;
        author = oembed?.author_name;
        text = oembed?.title || "";
    } catch (e: any) {
      console.error("TikTok oEmbed failed:", e?.message ?? e);
    }
    return { platform, title, author, text };
  }

  return { platform, text: "" };
}
