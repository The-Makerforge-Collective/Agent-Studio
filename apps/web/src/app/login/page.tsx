"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

function LogoIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Hexagonal triangle: three connected dots */}
      <line x1="8" y1="28" x2="28" y2="28" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="28" x2="18" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="28" y1="28" x2="18" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="8" r="3.5" fill="currentColor" />
      <circle cx="8" cy="28" r="3.5" fill="currentColor" />
      <circle cx="28" cy="28" r="3.5" fill="currentColor" />
      {/* Center dot */}
      <circle cx="18" cy="21.5" r="2" fill="currentColor" opacity="0.5" />
      {/* Inner connections */}
      <line x1="18" y1="8" x2="18" y2="21.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="8" y1="28" x2="18" y2="21.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <line x1="28" y1="28" x2="18" y2="21.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-text-muted"
      aria-hidden="true"
    >
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 4l6 4.5L14 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SsoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSso() {
    const redirectUri = encodeURIComponent(window.location.origin + "/auth/callback");
    window.location.href =
      `http://localhost:8083/realms/agent-studio/protocol/openid-connect/auth?client_id=agent-studio-web&redirect_uri=${redirectUri}&response_type=code&scope=openid+profile+email`;
  }

  return (
    <div className="login-bg flex min-h-screen items-center justify-center px-4">
      <div
        className={`w-full max-w-[400px] transition-all duration-500 ease-out ${
          mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div className="rounded-xl border border-border bg-surface-card p-8 shadow-lg">
          {/* Branding */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-3 text-accent">
              <LogoIcon />
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-accent">
              Agent Studio
            </h1>
            <p className="mt-1.5 text-sm text-text-muted">
              Build, deploy, and orchestrate AI agents
            </p>
          </div>

          {/* SSO Button */}
          <button
            type="button"
            onClick={handleSso}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-surface-card"
          >
            <SsoIcon />
            Continue with SSO
          </button>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-muted">or continue with email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0" aria-hidden="true">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
                <line x1="8" y1="4.5" x2="8" y2="8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="8" cy="11" r="0.8" fill="currentColor" />
              </svg>
              {error}
            </div>
          )}

          {/* Email/Password form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">
                Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <EnvelopeIcon />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent/30"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-text-muted">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                  className="w-full rounded-lg border border-border bg-surface py-2.5 pl-3 pr-9 text-sm outline-none transition-colors placeholder:text-text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted transition-colors hover:text-text"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-border/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-surface-card disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="50 20" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-4 text-center text-[11px] text-text-muted/60">
          Agent Studio v0.1
        </p>
      </div>
    </div>
  );
}
