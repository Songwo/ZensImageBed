import { NextResponse } from "next/server";
import { listApiKeys, createApiKey } from "@/lib/apikey-store";
import { z } from "zod";

export const runtime = "edge";

export async function GET() {
  const keys = await listApiKeys();
  // 不返回完整 key，只返回前8位用于展示
  const masked = keys.map(({ key, ...rest }) => ({
    ...rest,
    keyPreview: key.slice(0, 12) + "..."
  }));
  return NextResponse.json({ keys: masked });
}

const createSchema = z.object({
  name: z.string().min(1).max(64)
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }
  const entry = await createApiKey(parsed.data.name);
  return NextResponse.json({ key: entry });
}
