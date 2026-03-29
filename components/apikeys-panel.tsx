"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Copy, KeyRound, LogOut, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type ApiKeyItem = {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
};

type NewKeyResult = {
  id: string;
  name: string;
  key: string;
  createdAt: string;
};

async function fetchKeys(): Promise<ApiKeyItem[]> {
  const res = await fetch("/api/apikeys");
  if (!res.ok) throw new Error("加载失败");
  const data = await res.json();
  return data.keys;
}

async function createKey(name: string): Promise<NewKeyResult> {
  const res = await fetch("/api/apikeys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error("创建失败");
  const data = await res.json();
  return data.key;
}

async function deleteKey(id: string) {
  const res = await fetch(`/api/apikeys/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除失败");
}

export function ApiKeysPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["apikeys"],
    queryFn: fetchKeys
  });

  const createMutation = useMutation({
    mutationFn: createKey,
    onSuccess: (result) => {
      setNewKey(result);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["apikeys"] });
    },
    onError: () => toast.error("创建 API Key 失败")
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apikeys"] });
      toast.success("已删除");
    },
    onError: () => toast.error("删除失败")
  });

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    toast.success("已复制到剪贴板");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-primary-100),transparent_40%),linear-gradient(180deg,var(--background),var(--muted))] p-6 md:p-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {/* 顶栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold">API 密钥管理</h1>
              <p className="text-xs text-muted-foreground">供第三方应用调用图床接口</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push("/upload")}>上传台</Button>
            <Button variant="ghost" size="sm" onClick={() => router.push("/gallery")}>图库</Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 新创建的 Key 展示（仅一次） */}
        {newKey && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-green-600 dark:text-green-400">Key 已创建，请立即复制保存！关闭后无法再次查看完整 Key。</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-background/80 px-3 py-2 font-mono text-sm">
                  <span className="flex-1 break-all">{newKey.key}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyKey(newKey.key)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => setNewKey(null)}>我已保存，关闭</Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* 创建新 Key */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">创建新 API Key</CardTitle>
            <CardDescription>为每个接入应用创建独立的 Key，方便管理和撤销。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="key-name">Key 名称</Label>
                <Input
                  id="key-name"
                  placeholder="如：我的 Java 博客"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  maxLength={64}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleCreate} disabled={!name.trim() || createMutation.isPending}>
                  <Plus className="mr-1 h-4 w-4" />
                  创建
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Key 列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">已有 API Key</CardTitle>
            <CardDescription>
              共 {keys.length} 个。调用接口时在请求头中携带：
              <code className="ml-1 rounded bg-muted px-1 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">加载中...</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无 API Key，请先创建。</p>
            ) : (
              <ul className="space-y-2">
                {keys.map((k) => (
                  <motion.li
                    key={k.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{k.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{k.keyPreview}</p>
                      <p className="text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleString("zh-CN")}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-2 h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(k.id)}
                      disabled={deleteMutation.isPending}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </motion.li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 接口说明 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">接口说明</CardTitle>
            <CardDescription>供 Java 等后端服务直接调用</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium mb-1">上传图片</p>
              <code className="block rounded bg-muted px-3 py-2 text-xs">POST /api/upload/direct</code>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 space-y-1 text-xs text-muted-foreground">
              <p><span className="text-foreground font-medium">请求格式：</span>multipart/form-data</p>
              <p><span className="text-foreground font-medium">file</span>（必填）图片文件</p>
              <p><span className="text-foreground font-medium">tags</span>（可选）逗号分隔标签，如 <code className="rounded bg-muted px-1">blog,avatar</code></p>
              <p><span className="text-foreground font-medium">folder</span>（可选）存储目录，如 <code className="rounded bg-muted px-1">posts</code></p>
            </div>
            <div>
              <p className="font-medium mb-1">响应示例</p>
              <pre className="rounded bg-muted px-3 py-2 text-xs overflow-x-auto">{`{
  "url": "https://your-domain.com/2026-03-29/uuid-photo.jpg",
  "key": "2026-03-29/uuid-photo.jpg",
  "filename": "photo.jpg",
  "size": 102400
}`}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
