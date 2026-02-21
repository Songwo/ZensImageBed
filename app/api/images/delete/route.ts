import { z } from "zod";
import { NextResponse } from "next/server";
import { deleteImages } from "@/lib/r2";

const schema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100)
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }

  await deleteImages(parsed.data.keys);
  return NextResponse.json({ ok: true });
}
