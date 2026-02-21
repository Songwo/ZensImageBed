import type { Metadata } from "next";
import { Space_Grotesk, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";

const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
export const runtime = "edge";

export const metadata: Metadata = {
  title: {
    default: "ZensImage | Cloudflare R2 图床",
    template: "%s | ZensImage"
  },
  description: "一个高颜值、可私有管理、支持直传 Cloudflare R2 的现代图床应用。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${heading.variable} ${body.variable} antialiased`}>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
