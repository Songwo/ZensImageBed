"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import exifr from "exifr";
import { ImagePlus, Loader2, LogOut, Sparkles, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ThemeToggle } from "@/components/theme-toggle";

type UploadItem = {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  aiTags: string[];
  exif?: string;
};

function aiTagger(filename: string, exif?: string) {
  const base = filename.toLowerCase();
  const raw = base.split(/[-_.\s]+/g).filter((s) => s.length > 2);
  const hints = ["screenshot", "avatar", "poster", "banner", "photo", "travel", "food"].filter((h) => base.includes(h));
  if (exif?.toLowerCase().includes("iphone")) hints.push("iphone");
  return Array.from(new Set([...raw.slice(0, 4), ...hints]));
}

function xhrUpload(url: string, file: File, headers: Record<string, string>, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

export function UploadPanel() {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [manualTags, setManualTags] = useState("");
  const [folder, setFolder] = useState("");
  const [uploading, setUploading] = useState(false);

  const pendingCount = useMemo(() => items.filter((i) => i.status !== "done").length, [items]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Number(process.env.NEXT_PUBLIC_MAX_FILES_PER_UPLOAD ?? 20));

    const next = await Promise.all(
      list.map(async (file) => {
        const exifData = await exifr.parse(file, ["Make", "Model", "DateTimeOriginal"]).catch(() => null);
        const exif = exifData ? [exifData.Make, exifData.Model, exifData.DateTimeOriginal].filter(Boolean).join(" ") : undefined;
        return {
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          progress: 0,
          status: "pending" as const,
          aiTags: aiTagger(file.name, exif),
          exif
        };
      })
    );

    setItems((prev) => [...prev, ...next].slice(0, 20));
  };

  const startUpload = async () => {
    if (!items.length) return;
    setUploading(true);
    const tagsFromInput = manualTags.split(",").map((t) => t.trim()).filter(Boolean);

    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: items.map((it) => ({
          filename: it.file.name,
          contentType: it.file.type || "application/octet-stream",
          size: it.file.size,
          tags: Array.from(new Set([...tagsFromInput, ...it.aiTags])),
          folder: folder || undefined,
          exif: it.exif
        }))
      })
    });

    if (!presignRes.ok) {
      toast.error((await presignRes.json().catch(() => ({ message: "签名失败" }))).message);
      setUploading(false);
      return;
    }

    const { items: signedItems } = await presignRes.json() as {
      items: Array<{ signedUrl: string; signedHeaders?: Record<string, string> }>;
    };

    const resultFlags: boolean[] = [];
    for (let idx = 0; idx < items.length; idx += 1) {
      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, status: "uploading" } : x)));
      try {
        await xhrUpload(signedItems[idx].signedUrl, items[idx].file, signedItems[idx].signedHeaders ?? {}, (progress) => {
          setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, progress } : x)));
        });
        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, status: "done", progress: 100 } : x)));
        resultFlags.push(true);
      } catch (error) {
        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, status: "error", error: (error as Error).message } : x)));
        resultFlags.push(false);
      }
    }

    setUploading(false);
    if (resultFlags.every(Boolean)) {
      toast.success("上传完成，正在跳转图库");
      router.push("/gallery");
      router.refresh();
    } else {
      toast.warning("部分上传失败，请重试");
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,var(--background),var(--muted))] p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between rounded-2xl border bg-card/70 p-4 backdrop-blur">
          <div>
            <h1 className="font-heading text-2xl font-bold">上传中心</h1>
            <p className="text-sm text-muted-foreground">预签名直传 R2，支持 EXIF 与 AI 自动标签</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" onClick={() => router.push("/gallery")}>图库</Button>
            <Button variant="ghost" onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />退出</Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>批量上传</CardTitle>
            <CardDescription>拖拽或点击添加图片，单次最多 20 张</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-center transition hover:bg-primary/10">
              <UploadCloud className="mb-3 h-8 w-8 text-primary" />
              <p className="font-medium">拖拽图片到这里，或点击选择文件</p>
              <p className="text-xs text-muted-foreground">支持多图、自动读取 EXIF、AI 标签建议</p>
              <input type="file" className="hidden" multiple accept="image/*" onChange={(e) => void onFiles(e.target.files)} />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>手动标签（逗号分隔）</Label>
                <Input placeholder="travel, cover, screenshot" value={manualTags} onChange={(e) => setManualTags(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>文件夹（可选）</Label>
                <Input placeholder="portfolio / docs" value={folder} onChange={(e) => setFolder(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <motion.div key={item.id} layout className="rounded-xl border bg-background p-3">
                  <img src={item.preview} alt={item.file.name} className="mb-2 h-40 w-full rounded-lg object-cover" />
                  <p className="line-clamp-1 text-sm font-medium">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</p>
                  <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Sparkles className="h-3 w-3" />{item.aiTags.join(", ") || "无建议标签"}
                  </div>
                  <Progress className="mt-2" value={item.progress} />
                  <p className="mt-1 text-xs">
                    {item.status === "uploading" && <span>上传中...</span>}
                    {item.status === "done" && <span className="text-green-600">完成</span>}
                    {item.status === "error" && <span className="text-red-500">失败: {item.error}</span>}
                    {item.status === "pending" && <span className="text-muted-foreground">等待上传</span>}
                  </p>
                </motion.div>
              ))}
            </div>

            <Button onClick={startUpload} disabled={!items.length || uploading} className="w-full md:w-auto">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {uploading ? `上传中 (${pendingCount})` : "开始上传"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
