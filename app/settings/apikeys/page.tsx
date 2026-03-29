import { redirect } from "next/navigation";
import { getIsAuthed } from "@/lib/auth";
import { ApiKeysPanel } from "@/components/apikeys-panel";

export const runtime = "edge";
export const metadata = { title: "API 密钥管理" };

export default async function ApiKeysPage() {
  const authed = await getIsAuthed();
  if (!authed) redirect("/login");
  return <ApiKeysPanel />;
}
