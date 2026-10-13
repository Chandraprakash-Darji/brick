/**
 * Umami analytics helper, mirroring `src/lib/analytics.ts` in
 * Chandraprakash-Darji/portfolio.
 *
 * The Umami tracker script is injected in `src/routes/__root.tsx` only when
 * `VITE_UMAMI_URL` and `VITE_UMAMI_WEBSITE_ID` are set (Production only).
 * All tracking calls below are no-ops when the script is absent, so local dev,
 * previews and forks never send events.
 */

export type UmamiEventData = Record<string, string | number>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: UmamiEventData) => void;
    };
  }
}

export function trackEvent(event: string, data?: UmamiEventData): void {
  if (typeof window === "undefined") return;
  if (window.umami && typeof window.umami.track === "function") {
    window.umami.track(event, data);
  }
}
