
// src/app/api/transcribe/route.ts
import { z } from "zod";
import { transcribeUrl } from "@/lib/server/transcribe";

export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().url(),
  model: z.string().optional().default("tiny"),
});

export async function POST(req: Request) {
  try {
    const { url, model } = BodySchema.parse(await req.json());
    const res = await transcribeUrl(url, model);
    return Response.json({ ok: true, ...res });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
