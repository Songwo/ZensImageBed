import Link from "next/link";
import { getIsAuthed } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const authed = await getIsAuthed();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--color-primary-100),transparent_40%),linear-gradient(180deg,var(--background),var(--muted))] p-6 md:p-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 rounded-3xl border border-border/50 bg-card/60 p-6 shadow-xl backdrop-blur md:p-10">
        <div className="space-y-4">
          <p className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary">Cloudflare Pages + R2</p>
          <h1 className="font-heading text-4xl font-bold tracking-tight md:text-6xl">ImageBed Zens</h1>
          <p className="max-w-2xl text-muted-foreground md:text-lg">高颜值个人/小型公益图床，支持预签名直传、私有管理、批量删除与多格式链接生成。</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {authed ? (
            <>
              <Button asChild><Link href="/upload">进入上传台</Link></Button>
              <Button variant="outline" asChild><Link href="/gallery">打开图库</Link></Button>
            </>
          ) : (
            <>
              <Button asChild><Link href="/login">请登录后使用</Link></Button>
              <Button variant="outline" asChild><Link href="/login">管理员登录</Link></Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
