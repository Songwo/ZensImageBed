"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";

const schema = z.object({
  password: z.string().min(1, "请输入密码")
});

type FormData = z.infer<typeof schema>;
type SafeRoute = "/upload" | "/gallery";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fromPath, setFromPath] = useState<SafeRoute | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    setFromPath(from === "/gallery" || from === "/upload" ? (from as SafeRoute) : null);
  }, []);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });

    setLoading(false);
    if (!res.ok) {
      toast.error("登录失败，密码错误");
      return;
    }

    toast.success("登录成功");
    const safeRoute = fromPath ?? "/upload";
    router.push(safeRoute);
    router.refresh();
  });

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklch,var(--primary)_25%,transparent),transparent_40%),radial-gradient(circle_at_80%_80%,color-mix(in_oklch,var(--primary)_20%,transparent),transparent_45%)]" />
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-md">
        <Card className="border-border/40 bg-card/80 backdrop-blur">
          <CardHeader>
            <div className="mb-2 flex items-center justify-between">
              <div className="rounded-xl bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
              <ThemeToggle />
            </div>
            <CardTitle>管理员登录</CardTitle>
            <CardDescription>登录后可上传和管理私有图片</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">访问密码</Label>
                <Input id="password" type="password" placeholder="请输入 ADMIN_PASSWORD" {...form.register("password")} />
                {form.formState.errors.password ? <p className="text-xs text-red-500">{form.formState.errors.password.message}</p> : null}
              </div>
              <Button className="w-full" disabled={loading}>{loading ? "登录中..." : "进入控制台"}</Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </main>
  );
}
