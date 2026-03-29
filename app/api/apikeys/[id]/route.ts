import { NextResponse } from "next/server";
import { deleteApiKey } from "@/lib/apikey-store";

export const runtime = "edge";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
