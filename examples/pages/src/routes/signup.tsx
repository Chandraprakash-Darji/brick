import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout } from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signUp } from "@/lib/auth";

import { redirectIfAuthed } from "./-guards";

export const Route = createFileRoute("/signup")({
  // CSR-only (old app was a pure SPA): the server never renders this route,
  // so no session fetch runs without cookies. beforeLoad is kept for
  // client-side navigations.
  beforeLoad: () => redirectIfAuthed(),
  component: SignupPage,
  head: () => ({
    meta: [{ title: "Create account — Pages" }],
  }),
  ssr: false,
});

/**
 * Port of app/src/routes/signup.vue.
 */
function SignupPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.email({ email, name, password });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
        return;
      }
      router.history.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="tui-panel relative">
        <span className="tui-title">create account</span>
        <div className="flex flex-col space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create account
          </h1>
          <p className="text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="accent-link underline underline-offset-4 hover:text-primary"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form className="mt-4 space-y-2" onSubmit={handleSignup}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="Your name"
            required
            type="text"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="Email address"
            required
            type="email"
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            placeholder="Password (8+ characters)"
            required
            type="password"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <a
            className="accent-link underline underline-offset-4 hover:text-primary"
            href="#"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            className="accent-link underline underline-offset-4 hover:text-primary"
            href="#"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </AuthLayout>
  );
}
