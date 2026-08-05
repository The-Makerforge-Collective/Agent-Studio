"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getEmail, logout } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "Workflows", icon: "M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7z" },
  { href: "/runs", label: "Runs", icon: "M5 3l7 5-7 5V3z" },
  { href: "/settings", label: "Settings", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const email = getEmail();
  const initial = email ? email.charAt(0).toUpperCase() : "U";

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-card">
        <div className="px-5 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight text-text">
            Agent Studio
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-text-muted hover:bg-surface hover:text-text"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent">
              {initial}
            </div>
            <span className="flex-1 truncate text-xs text-text-muted">{email}</span>
            <button
              onClick={logout}
              className="text-xs text-text-muted hover:text-text"
              title="Sign out"
            >
              &times;
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
