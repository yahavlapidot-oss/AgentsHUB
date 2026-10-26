"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { EmergencyStopButton } from "./emergency-stop";
import { useLive } from "./live";

export type NavItem = { href: string; label: string; icon: string; badge?: string; alert?: number };

/** Every page, in sidebar order. Shared by the sidebar and the phone menu. */
export function useNavItems(): NavItem[] {
  const { approvals, agents } = useLive();
  const online = agents.filter((a) => a.status !== "offline").length;
  const working = agents.filter((a) => a.currentTaskId && a.status !== "offline").length;
  return [
    { href: "/", label: "Main board", icon: "▦" },
    { href: "/projects", label: "Projects", icon: "◫" },
    { href: "/live", label: "Live workspace", icon: "▶", badge: working ? String(working) : undefined },
    { href: "/agents", label: "Agents", icon: "◉", badge: `${online}/${agents.length}` },
    { href: "/chat", label: "Chats", icon: "✉" },
    { href: "/schedules", label: "Schedules", icon: "⏱" },
    { href: "/notes", label: "Team notes", icon: "✎" },
    { href: "/artifacts", label: "Files", icon: "▧" },
    { href: "/usage", label: "Usage & costs", icon: "▤" },
    { href: "/approvals", label: "Approvals", icon: "✓", alert: approvals.length },
    { href: "/audit", label: "Audit log", icon: "☰" },
    { href: "/status", label: "System status", icon: "♥" },
    { href: "/settings", label: "Settings", icon: "⚙" },
  ];
}

export function isActive(path: string, href: string): boolean {
  return href === "/" ? path === "/" : path.startsWith(href);
}

/** The dark sidebar on tablets and computers. Phones get <MobileNav> instead. */
export function Sidebar() {
  const path = usePathname();
  const items = useNavItems();

  return (
    <nav className="sticky top-0 hidden h-screen w-14 shrink-0 flex-col bg-nav text-white/80 sm:flex md:w-60">
      <div className="flex items-center gap-2 px-4 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">A</span>
        <span className="hidden text-base font-semibold text-white md:inline">AgentsHUB</span>
      </div>
      <p className="hidden px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-white/40 md:block">
        Workspace
      </p>
      <ul className="flex flex-col gap-0.5 px-2">
        {items.map((it) => {
          const active = isActive(path, it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
                <LinkPending className="inset-y-1.5 left-0 w-0.5" />
                <span className="w-5 text-center text-base leading-none" aria-hidden>
                  {it.icon}
                </span>
                <span className="hidden flex-1 md:inline">{it.label}</span>
                {it.badge && <span className="hidden text-xs text-white/40 md:inline">{it.badge}</span>}
                {!!it.alert && (
                  <span className="rounded-full bg-[#e2445c] px-1.5 text-xs font-semibold text-white">{it.alert}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto">
        <EmergencyStopButton />
      </div>
    </nav>
  );
}

/** A small bar on a nav link from the moment it's clicked until its page shows. Put it inside a relative Link. */
export function LinkPending({ className }: { className: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden className={`pointer-events-none absolute animate-fade-in-late rounded-full bg-brand ${className}`} />;
}
