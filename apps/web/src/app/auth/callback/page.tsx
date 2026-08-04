"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const KEYCLOAK_TOKEN_URL =
  "http://localhost:8083/realms/agent-studio/protocol/openid-connect/token";
const CLIENT_ID = "agent-studio-web";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("No authorization code received.");
      return;
    }

    async function exchangeCode(authCode: string) {
      try {
        const redirectUri = window.location.origin + "/auth/callback";
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: authCode,
          redirect_uri: redirectUri,
        });

        const res = await fetch(KEYCLOAK_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Token exchange failed: ${res.status} ${text}`);
        }

        const data = await res.json();
        localStorage.setItem("auth_token", data.access_token);

        if (data.id_token) {
          // Extract email from id_token payload (JWT)
          try {
            const payload = JSON.parse(atob(data.id_token.split(".")[1]));
            if (payload.email) {
              localStorage.setItem("auth_email", payload.email);
            }
          } catch {
            // Non-critical: email extraction is best-effort
          }
        }

        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
      }
    }

    exchangeCode(code);
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface-card p-8 text-center shadow-lg">
          <div className="mb-3 text-red-500">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="mx-auto" aria-hidden="true">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" />
              <line x1="16" y1="9" x2="16" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="16" cy="22" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-semibold">Authentication Failed</h2>
          <p className="mb-4 text-sm text-text-muted">{error}</p>
          <a
            href="/login"
            className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-text-muted">
        <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="50 20" />
        </svg>
        <p className="text-sm font-medium">Signing in...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="50 20" />
            </svg>
            <p className="text-sm font-medium">Signing in...</p>
          </div>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
