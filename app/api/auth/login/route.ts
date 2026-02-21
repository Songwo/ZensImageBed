import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieName } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { password?: string } | null;
  const password = body?.password;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ message: "密码错误" }, { status: 401 });
  }

  const token = await createSessionToken();
  (await cookies()).set({
    name: sessionCookieName,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return NextResponse.json({ ok: true });
}
