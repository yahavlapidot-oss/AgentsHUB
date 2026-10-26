import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { EmergencyStopBanner } from "@/components/emergency-stop";
import { LiveProvider } from "@/components/live";
import { Toaster } from "@/components/toast";
import { MobileNav } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { getSnapshot } from "@/lib/data";
import { contentTag } from "@/lib/etag";
import { LOCKED_HEADER } from "@/lib/second-factor";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AgentsHUB",
  description: "Track what your AI agents are doing: tasks, progress, chat, models and tokens.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AgentsHUB", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14182b",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Before the authenticator code, show the code form alone: no board data, no live updates.
  if ((await headers()).get(LOCKED_HEADER)) {
    return (
      <html lang="en" className={`${sans.variable} ${mono.variable}`}>
        <body className="font-sans">
          <main className="min-h-dvh">{children}</main>
        </body>
      </html>
    );
  }
  const initial = await getSnapshot();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">
        <LiveProvider initial={initial} initialTag={contentTag(initial)}>
          <div className="flex min-h-dvh flex-col sm:flex-row">
            <Sidebar />
            <MobileNav />
            <main className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
              <EmergencyStopBanner />
              {children}
            </main>
          </div>
          <Toaster />
        </LiveProvider>
      </body>
    </html>
  );
}
