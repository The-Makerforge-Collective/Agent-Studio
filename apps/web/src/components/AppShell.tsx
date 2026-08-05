"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getEmail, logout } from "@/lib/auth";

const NAV_ITEMS = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Workflows", href: "/workflows", icon: WorkflowNavIcon },
  { label: "Agents", href: "/agents", icon: AppsNavIcon },
  { label: "Runs", href: "/runs", icon: RunsNavIcon },
  { label: "Tools", href: "/mcp-servers", icon: ToolsNavIcon },
  { label: "Skills", href: "/skills", icon: SkillsNavIcon },
  { label: "Settings", href: "/settings", icon: SettingsNavIcon },
];

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(getEmail());
  }, []);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Sidebar */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border/60 bg-surface-card">
        {/* Logo */}
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-80"
        >
          <svg width="22" height="22" viewBox="0 0 36 36" fill="none" className="text-accent">
            <line x1="8" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="1.8" />
            <line x1="8" y1="28" x2="18" y2="8" stroke="currentColor" strokeWidth="1.8" />
            <line x1="28" y1="28" x2="18" y2="8" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="18" cy="8" r="3" fill="currentColor" />
            <circle cx="8" cy="28" r="3" fill="currentColor" />
            <circle cx="28" cy="28" r="3" fill="currentColor" />
          </svg>
          <span className="text-[15px] font-semibold tracking-tight text-text">
            Agent Studio
          </span>
        </button>

        {/* Nav */}
        <nav className="flex-1 px-3 pt-1">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <button
                    onClick={() => router.push(item.href)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-text-muted hover:bg-surface hover:text-text"
                    }`}
                  >
                    <Icon active={active} />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom — user + health */}
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          {email && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent uppercase">
                {email[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-text">{email}</div>
                <button
                  onClick={logout}
                  className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
            <span className="text-[11px] text-text-muted">Platform healthy</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

/* ——— Nav Icons ——— */

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M2.5 6.5L8 2l5.5 4.5V13a1 1 0 01-1 1h-3V10H6.5v4h-3a1 1 0 01-1-1V6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function WorkflowNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <circle cx="8" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="4" cy="13" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="12" cy="13" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 4.8V8L4.5 11.2M8 8l3.5 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function ToolsNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <rect x="2" y="2" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="10" width="12" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="5" cy="4" r="0.8" fill="currentColor"/>
      <circle cx="5" cy="12" r="0.8" fill="currentColor"/>
      <path d="M8 6v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function SkillsNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M6 2L2.5 8l3.5 6h3L12.5 8 9 2H6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="7.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function RunsNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path d="M5 3l7 5-7 5V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  );
}

function SettingsNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function AppsNavIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={active ? "text-accent" : "text-text-muted"}>
      <path
        d="M2.5 3.5h11A1 1 0 0114.5 4.5v7a1 1 0 01-1 1h-7L4 14.5v-2H2.5a1 1 0 01-1-1v-7a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5.5" cy="8" r="0.7" fill="currentColor" />
      <circle cx="8" cy="8" r="0.7" fill="currentColor" />
      <circle cx="10.5" cy="8" r="0.7" fill="currentColor" />
    </svg>
  );
}
