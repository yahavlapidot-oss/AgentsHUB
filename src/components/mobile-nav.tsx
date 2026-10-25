"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { EmergencyStopButton } from "./emergency-stop";
import { LinkPending, isActive, useNavItems, type NavItem } from "./sidebar";

/** The pages that get their own tab on a phone; the rest are under More. */
const TABS = ["/", "/live", "/approvals", "/agents"];

/** Phones: a top bar with the page name and the stop button, and tabs at the bottom. */
export function MobileNav() {
  const path = usePathname();
  const items = useNavItems();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const tabs = TABS.map((href) => items.find((it) => it.href === href)!);
  const rest = items.filter((it) => !TABS.includes(it.href));
  const moreAlert = rest.some((it) => it.alert);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-nav px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white sm:hidden">
        <Link href="/" className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand text-sm font-bold" aria-label="AgentsHUB home">
          A
        </Link>
        <p className="min-w-0 flex-1 truncate font-semibold">AgentsHUB</p>
        <EmergencyStopButton compact />
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label="Main"
      >
        {tabs.map((it) => (
          <Tab key={it.href} item={it} active={isActive(path, it.href) && !more} />
        ))}
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${more || rest.some((it) => isActive(path, it.href)) ? "text-brand" : "text-ink-soft"}`}
        >
          <span className="text-lg leading-none" aria-hidden>⋯</span>
          More
          {moreAlert && <span className="absolute right-[30%] top-2 h-2 w-2 rounded-full bg-[#e2445c]" />}
        </button>
      </nav>

      {more && (
        <div className="fixed inset-0 z-20 animate-fade-in bg-black/30 sm:hidden" onClick={() => setMore(false)}>
          <ul
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] grid animate-sheet-up grid-cols-2 gap-1 rounded-t-xl bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {rest.map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-sm ${isActive(path, it.href) ? "bg-brand-soft text-brand" : "hover:bg-canvas"}`}
                >
                  <span className="w-5 text-center" aria-hidden>{it.icon}</span>
                  <span className="flex-1">{it.label}</span>
                  {it.badge && <span className="text-xs text-ink-faint">{it.badge}</span>}
                  {!!it.alert && <span className="rounded-full bg-[#e2445c] px-1.5 text-xs font-semibold text-white">{it.alert}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const short = { "/": "Board", "/live": "Live", "/approvals": "Approvals", "/agents": "Agents" }[item.href] ?? item.label;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "text-brand" : "text-ink-soft"}`}
    >
      <LinkPending className="inset-x-[30%] top-0 h-0.5" />
      <span className="text-lg leading-none" aria-hidden>{item.icon}</span>
      {short}
      {!!item.alert && (
        <span className="absolute right-[22%] top-1.5 min-w-4 rounded-full bg-[#e2445c] px-1 text-center text-[10px] font-semibold leading-4 text-white">{item.alert}</span>
      )}
      {item.href === "/live" && item.badge && (
        <span className="absolute right-[26%] top-1.5 min-w-4 rounded-full bg-[#00c875] px-1 text-center text-[10px] font-semibold leading-4 text-white">{item.badge}</span>
      )}
    </Link>
  );
}
