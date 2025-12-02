import { z } from "zod";
import { transcribeUrl } from "@/lib/server/transcribeUrl";

export const runtime = "nodejs";

const BodySchema = z.object({
  url: z.string().url(),
  model: z.string().optional().default("base"),
});

export async function POST(req: Request) {
  try {
    const { url, model } = BodySchema.parse(await req.json());
    const res = await transcribeUrl(url, model);
    return Response.json({ ok: true, ...res });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
