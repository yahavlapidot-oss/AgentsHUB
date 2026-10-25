"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EmergencyStopButton } from "./emergency-stop";
import { useLive } from "./live";

export function Sidebar() {
  const path = usePathname();
  const { approvals, agents } = useLive();
  const online = agents.filter((a) => a.status !== "offline").length;

  const items = [
    { href: "/", label: "Main board", icon: "▦" },
    { href: "/projects", label: "Projects", icon: "◫" },
    { href: "/agents", label: "Agents", icon: "◉", badge: `${online}/${agents.length}` },
    { href: "/chat", label: "Agent chat", icon: "✉" },
    { href: "/notes", label: "Team notes", icon: "✎" },
    { href: "/artifacts", label: "Files", icon: "▧" },
    { href: "/usage", label: "Models & tokens", icon: "▤" },
    { href: "/approvals", label: "Approvals", icon: "✓", alert: approvals.length },
    { href: "/audit", label: "Audit log", icon: "☰" },
  ];

  return (
    <nav className="sticky top-0 flex h-screen w-14 shrink-0 flex-col bg-nav text-white/80 md:w-60">
      <div className="flex items-center gap-2 px-4 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">A</span>
        <span className="hidden text-base font-semibold text-white md:inline">AgentsHUB</span>
      </div>
      <p className="hidden px-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-white/40 md:block">
        Workspace
      </p>
      <ul className="flex flex-col gap-0.5 px-2">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
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
