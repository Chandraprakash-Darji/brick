import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { AuthDivider } from "@/components/AuthDivider";
import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth";

import { redirectIfAuthed, toSafeRedirect } from "./-guards";

interface LoginSearch {
  redirect?: string;
  [key: string]: string | undefined;
}

export const Route = createFileRoute("/login")({
  // CSR-only (old app was a pure SPA): the server never renders this route,
  // so no session fetch runs without cookies. beforeLoad is kept for
  // client-side navigations.
  beforeLoad: () => redirectIfAuthed(),
  component: LoginPage,
  head: () => ({
    meta: [{ title: "Sign in — Pages" }],
  }),
  ssr: false,
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    // Pass through string query params (client_id + fellow OAuth authorize
    // params) so the mid-OAuth-flow query survives. Everything is optional
    // so plain `<Link to="/login">` stays valid; `redirect` defaults to
    // /dashboard like the old `route.query.redirect` computed.
    const out: LoginSearch = {};
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string") out[key] = value;
    }
    if (out.redirect === undefined) out.redirect = "/dashboard";
    return out;
  },
});

type Step = "email" | "password";

/**
 * Port of app/src/routes/login.vue.
 * Two-step sign-in (email -> password). When reached mid OAuth flow (the
 * authorize endpoint redirects here with the signed query), resumes
 * authorization after sign-in instead of going to the redirect target.
 */
function LoginPage() {
  const router = useRouter();
  const { redirect: redirectTarget } = Route.useSearch();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("password");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign in failed");
      } else {
        // Resume a mid-OAuth-flow authorization if its signed query is present.
        // Old check was `typeof route.query.client_id !== "string"` (i.e. any
        // string, including "") — mirror it with `!= null` so an empty
        // client_id behaves the same as before.
        const query = window.location.search.replace(/^\?/, "");
        const params = new URLSearchParams(window.location.search);
        if (params.get("client_id") != null) {
          const apiBase: string = import.meta.env.VITE_API_BASE ?? "";
          window.location.href = `${apiBase}/api/auth/oauth2/authorize?${query}`;
        } else {
          // `redirect` may be a legacy absolute URL (old consent handoff
          // passed the full href) — reduce same-origin URLs to path+query.
          router.history.push(toSafeRedirect(redirectTarget));
        }
      }
    } catch {
      setError("Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      {step === "email" ? (
        <div className="tui-panel relative">
          <span className="tui-title">sign in</span>
          <div className="flex flex-col space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-xs text-muted-foreground">
              New to pages·dev?{" "}
              <Link
                to="/signup"
                className="accent-link underline underline-offset-4 hover:text-primary"
              >
                Create an account
              </Link>
            </p>
          </div>

          <div className="mt-4 space-y-4">
            <form className="space-y-2" onSubmit={handleContinue}>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="Enter your email"
                required
                type="email"
              />
              <Button className="w-full" type="submit">
                Continue with email
              </Button>
            </form>

            <AuthDivider>OR</AuthDivider>

            <p className="text-center text-xs text-muted-foreground">
              Enter your email above to continue.
            </p>
          </div>
        </div>
      ) : (
        <div className="tui-panel relative">
          <span className="tui-title">sign in</span>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>

          <div className="mt-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Signing in as{" "}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          </div>

          <form className="mt-4 space-y-2" onSubmit={handleSignIn}>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              placeholder="Enter your password"
              required
              type="password"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button className="w-full" disabled={loading} type="submit">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              to="/signup"
              className="accent-link underline underline-offset-4 hover:text-primary"
            >
              Create one
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
