import { z } from "zod";
import { NextResponse } from "next/server";
import { listImages } from "@/lib/r2";

export const runtime = "edge";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(24),
  search: z.string().optional(),
  tag: z.string().optional()
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    tag: searchParams.get("tag") ?? undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid query" }, { status: 400 });
  }

  const data = await listImages(parsed.data);
  return NextResponse.json(data);
}
