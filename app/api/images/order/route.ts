import { z } from "zod";
import { NextResponse } from "next/server";
import { loadImageOrder, saveImageOrderGroups } from "@/lib/order-store";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  groups: z.object({
    today: z.array(z.string().min(1)).max(10000),
    week: z.array(z.string().min(1)).max(10000),
    older: z.array(z.string().min(1)).max(10000)
  })
});

export async function GET() {
  try {
    const data = await loadImageOrder();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { message: "读取排序失败", detail: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }

  try {
    const data = await saveImageOrderGroups(parsed.data.groups);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { message: "保存排序失败", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
