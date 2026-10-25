import type { Metadata } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import { EmergencyStopBanner } from "@/components/emergency-stop";
import { LiveProvider } from "@/components/live";
import { Sidebar } from "@/components/sidebar";
import { getSnapshot } from "@/lib/data";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "AgentsHUB",
  description: "Track what your AI agents are doing: tasks, progress, chat, models and tokens.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initial = await getSnapshot();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans">
        <LiveProvider initial={initial}>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1">
              <EmergencyStopBanner />
              {children}
            </main>
          </div>
        </LiveProvider>
      </body>
    </html>
  );
}
