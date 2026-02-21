"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isThisWeek, isToday } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  Copy,
  Folder,
  ImageOff,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  Search,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatBytes } from "@/lib/utils";

type GroupId = "today" | "week" | "older";

type ImageItem = {
  key: string;
  url: string;
  filename: string;
  size: number;
  uploadedAt: string;
  tags: string[];
  folder: string | null;
  exif: string | null;
};

type ApiPage = {
  items: ImageItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

type GroupOrders = Record<GroupId, string[]>;

const SECTION_ORDER: GroupId[] = ["today", "week", "older"];
const SECTION_LABEL: Record<GroupId, string> = {
  today: "今天",
  week: "本周",
  older: "更早"
};

function buildThumb(url: string) {
  try {
    const u = new URL(url);
    return `${u.origin}/cdn-cgi/image/width=400,quality=85,format=auto/${url}`;
  } catch {
    return url;
  }
}

function groupIdFromDate(date: string): GroupId {
  const d = new Date(date);
  if (isToday(d)) return "today";
  if (isThisWeek(d, { weekStartsOn: 1 })) return "week";
  return "older";
}

function linkFormats(url: string, alt: string) {
  return {
    url,
    markdown: `![${alt}](${url})`,
    html: `<img src="${url}" alt="${alt}" width="800" />`,
    bbcode: `[img]${url}[/img]`
  };
}

function reorder<T>(arr: T[], from: number, to: number) {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function emptyGroupOrders(): GroupOrders {
  return { today: [], week: [], older: [] };
}

function serializeGroups(groups: GroupOrders) {
  return JSON.stringify(groups);
}

function parseDragPayload(event: DragEvent<HTMLDivElement>) {
  const raw = event.dataTransfer.getData("text/plain");
  try {
    return JSON.parse(raw) as { key: string; group: GroupId };
  } catch {
    return null;
  }
}

export function GalleryPanel() {
  const qc = useQueryClient();
  const loaderRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState("grid");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [groupOrders, setGroupOrders] = useState<GroupOrders>(emptyGroupOrders);
  const [orderDirty, setOrderDirty] = useState(false);
  const orderInitializedRef = useRef(false);
  const lastSavedOrderRef = useRef(serializeGroups(emptyGroupOrders()));

  const orderQuery = useQuery({
    queryKey: ["image-order"],
    queryFn: async () => {
      const res = await fetch("/api/images/order");
      if (!res.ok) throw new Error("读取排序失败");
      return res.json() as Promise<{ groups: GroupOrders; updatedAt: string | null; backend: "kv" | "r2" }>;
    }
  });

  const query = useInfiniteQuery({
    queryKey: ["images", search, tag],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const params = new URLSearchParams({ limit: "24" });
      if (pageParam) params.set("cursor", pageParam);
      if (search) params.set("search", search);
      if (tag) params.set("tag", tag);
      const res = await fetch(`/api/images?${params.toString()}`);
      if (!res.ok) throw new Error("加载失败");
      return res.json() as Promise<ApiPage>;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined)
  });

  const flat = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const itemsByGroup = useMemo(() => {
    const grouped: Record<GroupId, ImageItem[]> = { today: [], week: [], older: [] };
    flat.forEach((item) => {
      grouped[groupIdFromDate(item.uploadedAt)].push(item);
    });
    return grouped;
  }, [flat]);

  useEffect(() => {
    if (!flat.length) return;

    setGroupOrders((prev) => {
      const savedGroups = orderQuery.data?.groups ?? emptyGroupOrders();
      const next = emptyGroupOrders();

      SECTION_ORDER.forEach((groupId) => {
        const currentKeys = new Set(itemsByGroup[groupId].map((i) => i.key));
        const baseOrder = orderInitializedRef.current ? prev[groupId] : savedGroups[groupId];
        const exist = baseOrder.filter((k) => currentKeys.has(k));
        const incoming = itemsByGroup[groupId].map((i) => i.key).filter((k) => !exist.includes(k));
        next[groupId] = [...exist, ...incoming];
      });

      if (!orderInitializedRef.current) {
        orderInitializedRef.current = true;
        lastSavedOrderRef.current = serializeGroups(next);
      }

      return next;
    });
  }, [flat, itemsByGroup, orderQuery.data]);

  useEffect(() => {
    if (!orderDirty) return;
    const timer = window.setTimeout(async () => {
      const serialized = serializeGroups(groupOrders);
      if (serialized === lastSavedOrderRef.current) {
        setOrderDirty(false);
        return;
      }

      const res = await fetch("/api/images/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: groupOrders })
      });

      if (!res.ok) {
        toast.error("分组排序保存失败");
        return;
      }

      const payload = await res.json() as { backend: "kv" | "r2" };
      lastSavedOrderRef.current = serialized;
      setOrderDirty(false);
      toast.success(`分组排序已保存（${payload.backend.toUpperCase()}）`);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [groupOrders, orderDirty]);

  const sortedByGroup = useMemo(() => {
    const result: Record<GroupId, ImageItem[]> = { today: [], week: [], older: [] };
    SECTION_ORDER.forEach((groupId) => {
      const map = new Map(itemsByGroup[groupId].map((i) => [i.key, i]));
      const ordered = groupOrders[groupId].map((key) => map.get(key)).filter(Boolean) as ImageItem[];
      result[groupId] = ordered;
    });
    return result;
  }, [itemsByGroup, groupOrders]);

  const sortedItems = useMemo(() => SECTION_ORDER.flatMap((g) => sortedByGroup[g]), [sortedByGroup]);

  useEffect(() => {
    if (!loaderRef.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    });
    io.observe(loaderRef.current);
    return () => io.disconnect();
  }, [query]);

  const onCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  };

  const deleteKeys = async (keys: string[]) => {
    const res = await fetch("/api/images/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys })
    });

    if (!res.ok) {
      toast.error("删除失败");
      return;
    }

    toast.success(`已删除 ${keys.length} 张`);
    setSelected([]);
    setDeleteOpen(false);
    setGroupOrders((prev) => ({
      today: prev.today.filter((key) => !keys.includes(key)),
      week: prev.week.filter((key) => !keys.includes(key)),
      older: prev.older.filter((key) => !keys.includes(key))
    }));
    setOrderDirty(true);
    await qc.invalidateQueries({ queryKey: ["images"] });
  };

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const allTags = Array.from(new Set(sortedItems.flatMap((item) => item.tags))).slice(0, 30);

  const onDragStart = (event: DragEvent<HTMLDivElement>, key: string, group: GroupId) => {
    event.dataTransfer.setData("text/plain", JSON.stringify({ key, group }));
  };

  const handleDropReorder = (event: DragEvent<HTMLDivElement>, targetGroup: GroupId, targetKey: string) => {
    const dragPayload = parseDragPayload(event);
    if (!dragPayload) return;
    if (dragPayload.group !== targetGroup) {
      toast.warning("仅支持同分组内拖拽排序");
      return;
    }

    const from = groupOrders[targetGroup].indexOf(dragPayload.key);
    const to = groupOrders[targetGroup].indexOf(targetKey);
    if (from >= 0 && to >= 0 && from !== to) {
      setGroupOrders((prev) => ({
        ...prev,
        [targetGroup]: reorder(prev[targetGroup], from, to)
      }));
      setOrderDirty(true);
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(145deg,var(--background),var(--muted))] p-4 md:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card/70 p-4 backdrop-blur">
          <h1 className="mr-auto font-heading text-2xl font-bold">图库管理</h1>
          <ThemeToggle />
          <Button variant="outline" onClick={() => (window.location.href = "/upload")}>上传</Button>
          <Button variant="ghost" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" />退出</Button>
        </header>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="搜索文件名/标签" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Tabs value={view} onValueChange={setView}>
              <TabsList>
                <TabsTrigger value="grid"><LayoutGrid className="mr-1 h-4 w-4" />网格</TabsTrigger>
                <TabsTrigger value="list"><List className="mr-1 h-4 w-4" />列表</TabsTrigger>
              </TabsList>
            </Tabs>

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={!selected.length}><Trash2 className="mr-1 h-4 w-4" />批量删除 {selected.length ? `(${selected.length})` : ""}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>确认删除</DialogTitle>
                  <DialogDescription>该操作不可撤销，将永久删除已选图片。</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
                  <Button onClick={() => void deleteKeys(selected)}>确认删除</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {allTags.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={tag ? "outline" : "default"} onClick={() => setTag("")}>全部标签</Button>
              {allTags.map((t) => (
                <Button key={t} size="sm" variant={tag === t ? "default" : "outline"} onClick={() => setTag(t)}>{t}</Button>
              ))}
            </div>
          ) : null}
        </Card>

        {SECTION_ORDER.map((groupId) => {
          const list = sortedByGroup[groupId];
          if (!list.length) return null;

          return (
            <section key={groupId} className="space-y-3">
              <h2 className="font-heading text-xl font-semibold">{SECTION_LABEL[groupId]}</h2>
              {view === "grid" ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <AnimatePresence>
                    {list.map((item) => {
                      const formats = linkFormats(item.url, item.filename);
                      const selectedState = selected.includes(item.key);
                      return (
                        <motion.div
                          key={item.key}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          draggable
                          onDragStartCapture={(e) => onDragStart(e, item.key, groupId)}
                          onDropCapture={(e) => handleDropReorder(e, groupId, item.key)}
                          onDragOverCapture={(e) => e.preventDefault()}
                          className={cn("group relative overflow-hidden rounded-2xl border bg-card", selectedState && "ring-2 ring-primary")}
                        >
                          <img src={buildThumb(item.url)} alt={item.filename} className="h-52 w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                          <div className="absolute left-2 top-2"><Checkbox checked={selectedState} onCheckedChange={(checked) => setSelected((prev) => checked ? [...new Set([...prev, item.key])] : prev.filter((k) => k !== item.key))} /></div>
                          <div className="space-y-1 p-3">
                            <p className="line-clamp-1 text-sm font-semibold">{item.filename}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(item.size)} · {format(new Date(item.uploadedAt), "yyyy-MM-dd HH:mm")}</p>
                            <div className="flex flex-wrap gap-1">
                              {item.folder ? <Badge><Folder className="mr-1 h-3 w-3" />{item.folder}</Badge> : null}
                              {item.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <Button size="sm" variant="outline" onClick={() => void onCopy(formats.url)}><Copy className="mr-1 h-3.5 w-3.5" />URL</Button>
                              <Button size="sm" variant="outline" onClick={() => void onCopy(formats.markdown)}>MD</Button>
                              <Button size="sm" variant="outline" onClick={() => void onCopy(formats.html)}>HTML</Button>
                              <Button size="sm" variant="outline" onClick={() => void onCopy(formats.bbcode)}>BBCode</Button>
                            </div>
                            <Button size="sm" className="mt-2 w-full" variant="ghost" onClick={() => void deleteKeys([item.key])}><Trash2 className="mr-1 h-3.5 w-3.5" />删除</Button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-3">选择</th><th className="p-3">文件</th><th className="p-3">标签</th><th className="p-3">时间</th><th className="p-3">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((item) => {
                        const selectedState = selected.includes(item.key);
                        return (
                          <tr key={item.key} className="border-t">
                            <td className="p-3"><Checkbox checked={selectedState} onCheckedChange={(checked) => setSelected((prev) => checked ? [...new Set([...prev, item.key])] : prev.filter((k) => k !== item.key))} /></td>
                            <td className="p-3">{item.filename} <span className="text-xs text-muted-foreground">({formatBytes(item.size)})</span></td>
                            <td className="p-3">{item.tags.join(", ") || "-"}</td>
                            <td className="p-3">{format(new Date(item.uploadedAt), "yyyy-MM-dd HH:mm")}</td>
                            <td className="p-3">
                              <Button size="sm" variant="outline" onClick={() => void onCopy(linkFormats(item.url, item.filename).markdown)}>复制 MD</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}

        {!query.isLoading && !sortedItems.length ? (
          <div className="flex min-h-60 items-center justify-center rounded-2xl border bg-card text-muted-foreground"><ImageOff className="mr-2 h-5 w-5" />暂无图片</div>
        ) : null}

        <div ref={loaderRef} className="flex h-14 items-center justify-center">
          {query.isFetchingNextPage || query.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        </div>
      </div>
    </main>
  );
}
