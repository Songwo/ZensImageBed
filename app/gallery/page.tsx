import { redirect } from "next/navigation";
import { getIsAuthed } from "@/lib/auth";
import { GalleryPanel } from "@/components/gallery-panel";

export default async function GalleryPage() {
  const authed = await getIsAuthed();
  if (!authed) redirect("/login");

  return <GalleryPanel />;
}
