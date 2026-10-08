import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/consent")({
  // CSR-only (old app was a pure SPA): the server never renders this route.
  component: ConsentPage,
  head: () => ({
    meta: [{ title: "Authorize access — Pages" }],
  }),
  ssr: false,
});

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

// Human-readable descriptions for the internally-supported scopes.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  email: "View your email address",
  offline_access: "Stay connected when you're not actively using the app",
  openid: "Verify your identity",
  profile: "View your basic profile information",
};

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
}

interface ConsentResult {
  redirect: boolean;
  url: string;
}

/**
 * Port of app/src/routes/consent.vue (OAuth2 consent screen).
 * No auth beforeLoad guard — a 401 from the public-client endpoint redirects
 * to /login with path+query as redirect (old `to.fullPath` shape, not the
 * full href), so login can resume the flow after sign-in.
 */
function ConsentPage() {
  const router = useRouter();

  // The signed authorization query (everything after "?", including the sig).
  const [oauthQuery] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.location.search.replace(/^\?/, ""),
  );
  const [queryParams] = useState(() =>
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  );
  const clientId = queryParams.get("client_id") ?? "";
  const scopes = (queryParams.get("scope") ?? "").split(" ").filter(Boolean);

  const [client, setClient] = useState<PublicClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const clientName = client?.client_name || "An application";

  function describeScope(scope: string): string {
    return SCOPE_DESCRIPTIONS[scope] ?? scope;
  }

  useEffect(() => {
    async function loadClient() {
      if (!clientId || !oauthQuery) {
        setError("Invalid authorization request.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
          { credentials: "include" },
        );
        if (res.status === 401) {
          router.history.push(
            `/login?redirect=${encodeURIComponent(
              window.location.pathname + window.location.search,
            )}`,
          );
          return;
        }
        if (!res.ok) {
          setError("Unable to load application details.");
          return;
        }
        setClient((await res.json()) as PublicClient);
      } catch {
        setError("Unable to load application details.");
      } finally {
        setLoading(false);
      }
    }
    void loadClient();
  }, [clientId, oauthQuery, router]);

  async function decide(accept: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/oauth2/consent`, {
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      const result = (await res.json()) as ConsentResult;
      if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="tui-panel relative">
        <span className="tui-title">authorize access</span>
        {loading ? (
          <div className="text-center font-mono text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
            <div className="flex flex-col space-y-1 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">
                Authorize access
              </h1>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {clientName}
                </span>{" "}
                wants to access your pages·dev account
              </p>
            </div>

            {error && (
              <p className="mt-4 text-center text-xs text-destructive">
                {error}
              </p>
            )}

            {scopes.length > 0 && (
              <div className="mt-4 space-y-3">
                <p className="font-mono text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                  This will allow {clientName} to:
                </p>
                <ul className="space-y-2">
                  {scopes.map((scope) => (
                    <li key={scope} className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary">{scope}</Badge>
                      <span className="text-muted-foreground">
                        {describeScope(scope)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button
                className="w-full"
                disabled={submitting}
                type="button"
                variant="outline"
                onClick={() => void decide(false)}
              >
                Deny
              </Button>
              <Button
                className="w-full"
                disabled={submitting}
                type="button"
                onClick={() => void decide(true)}
              >
                {submitting ? "Authorizing…" : "Allow"}
              </Button>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Authorizing will redirect you back to {clientName}.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
