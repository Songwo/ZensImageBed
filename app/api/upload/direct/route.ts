import { NextResponse } from "next/server";
import { directUpload } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyApiKey } from "@/lib/apikey-store";

export const runtime = "edge";

async function checkApiKey(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const key = auth.slice(7);
  return verifyApiKey(key);
}

export async function POST(req: Request) {
  if (!(await checkApiKey(req))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 10 * 1024 * 1024);

  const limitKey = req.headers.get("x-forwarded-for") ?? "api-client";
  const rate = checkRateLimit(limitKey);
  if (!rate.allowed) {
    return NextResponse.json({ message: "上传过于频繁，请稍后再试" }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ message: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Missing required field: file" }, { status: 400 });
  }

  if (file.size > maxFileSize) {
    return NextResponse.json(
      { message: `文件超出大小限制 (max ${maxFileSize / 1024 / 1024}MB)` },
      { status: 400 }
    );
  }

  const tagsRaw = formData.get("tags");
  const tags = tagsRaw
    ? String(tagsRaw)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const folderRaw = formData.get("folder");
  const folder = folderRaw
    ? String(folderRaw)
        .trim()
        .replace(/^\/+|\/+$/g, "") || undefined
    : undefined;

  const sanitized = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const datePrefix = new Date().toISOString().slice(0, 10);
  const key = folder
    ? `${datePrefix}/${folder}/${crypto.randomUUID()}-${sanitized}`
    : `${datePrefix}/${crypto.randomUUID()}-${sanitized}`;

  const body = await file.arrayBuffer();

  const result = await directUpload({
    key,
    contentType: file.type || "application/octet-stream",
    body,
    tags,
    folder,
    originalName: file.name
  });

  return NextResponse.json({
    key: result.key,
    url: result.url,
    filename: file.name,
    size: file.size,
    remaining: rate.remaining
  });
}
