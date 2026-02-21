import { redirect } from "next/navigation";
import { getIsAuthed } from "@/lib/auth";
import { UploadPanel } from "@/components/upload-panel";

export const runtime = "edge";

export default async function UploadPage() {
  const authed = await getIsAuthed();
  if (!authed) redirect("/login");

  return <UploadPanel />;
}
