import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { createPresignedPutUrl } from "@/lib/r2";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  files: z.array(
    z.object({
      filename: z.string().min(1),
      contentType: z.string().min(1),
      size: z.number().positive(),
      tags: z.array(z.string()).optional(),
      folder: z.string().optional(),
      exif: z.string().optional()
    })
  ).min(1)
});

export async function POST(req: Request) {
  const data = schema.safeParse(await req.json().catch(() => null));
  if (!data.success) {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }

  const maxFiles = Number(process.env.MAX_FILES_PER_UPLOAD ?? 20);
  const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 10 * 1024 * 1024);

  if (data.data.files.length > maxFiles) {
    return NextResponse.json({ message: `单次最多上传 ${maxFiles} 张` }, { status: 400 });
  }

  const limitKey = req.headers.get("x-forwarded-for") ?? "local-session";
  const rate = checkRateLimit(limitKey);
  if (!rate.allowed) {
    return NextResponse.json({ message: "上传过于频繁，请稍后再试" }, { status: 429 });
  }

  const signedItems = await Promise.all(
    data.data.files.map(async (file) => {
      if (file.size > maxFileSize) {
        throw new Error(`${file.filename} 超出大小限制`);
      }
      const sanitized = file.filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const datePrefix = new Date().toISOString().slice(0, 10);
      const cleanedFolder = file.folder?.trim().replace(/^\/+|\/+$/g, "");
      const folder = cleanedFolder ? cleanedFolder : undefined;
      const key = folder
        ? `${datePrefix}/${folder}/${randomUUID()}-${sanitized}`
        : `${datePrefix}/${randomUUID()}-${sanitized}`;

      const signed = await createPresignedPutUrl({
        key,
        contentType: file.contentType,
        tags: file.tags ?? [],
        folder,
        exif: file.exif,
        originalName: file.filename
      });

      return {
        key,
        ...signed
      };
    })
  );

  return NextResponse.json({ items: signedItems, remaining: rate.remaining });
}
