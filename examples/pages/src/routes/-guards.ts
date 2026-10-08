import { isRedirect, redirect } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { authClient } from "@/lib/auth";

/**
 * Normalize a post-login redirect target to a same-origin path+query string.
 *
 * History:
 * - The old vue-router guard passed `to.fullPath` (path+query).
 * - The old consent screen passed `window.location.href` (absolute URL).
 * Both shapes must keep working, so absolute http(s) URLs are reduced to
 * `pathname + search + hash`. Anything else (protocol-relative `//evil`,
 * non-http schemes, unparseable input, cross-origin absolute URLs on the
 * client) falls back to `/dashboard` to avoid open redirects.
 *
 * Server-safe: no `window` access except the same-origin check, which is
 * skipped during SSR (the stripped path is still same-origin when pushed
 * through the client router, so it stays safe).
 */
export function toSafeRedirect(raw: unknown): string {
  const fallback = "/dashboard";
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
  if (typeof window !== "undefined" && url.origin !== window.location.origin) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * beforeLoad guard for protected routes (dashboard, editor).
 * Mirrors app/src/router/index.ts PROTECTED_ROUTES behavior:
 * unauthenticated visits redirect to /login?redirect=<path+query>.
 *
 * Callers pass `location.href` (absolute); it is normalized to path+query
 * via toSafeRedirect so the login screen never receives a full href.
 *
 * SSR note: these routes additionally declare `ssr: false` (restoring the
 * old CSR-only app behavior — the server never renders them, so no
 * session fetch runs without cookies). beforeLoad is kept regardless: it
 * enforces auth on client-side navigations, and useRequireAuth below
 * covers the case where beforeLoad could not see the session.
 */
export async function requireAuth(href: string): Promise<void> {
  let session: unknown = null;
  try {
    const res = await authClient.getSession();
    session = res.data;
  } catch {
    return;
  }
  if (!session) {
    throw redirect({
      search: { redirect: toSafeRedirect(href) },
      to: "/login",
    });
  }
}

/**
 * beforeLoad guard for auth routes (login, signup).
 * Mirrors app/src/router/index.ts AUTH_ROUTES behavior:
 * signed-in visits go to /dashboard.
 */
export async function redirectIfAuthed(): Promise<void> {
  try {
    const { data: session } = await authClient.getSession();
    if (session) {
      throw redirect({ to: "/dashboard" });
    }
  } catch (err) {
    if (isRedirect(err)) throw err;
    // No session (or SSR without cookies): allow rendering.
  }
}

/**
 * Client-side enforcement for protected pages. Covers the case where
 * beforeLoad could not see the session (e.g. no cookies available).
 * Passes path+query (old `to.fullPath` shape), never a full href.
 */
export function useRequireAuth() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.history.push(
        `/login?redirect=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`,
      );
    }
  }, [isPending, session, router]);

  return { isPending, session };
}
