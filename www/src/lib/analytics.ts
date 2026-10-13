/**
 * Umami analytics helper, mirroring `src/lib/analytics.ts` in
 * Chandraprakash-Darji/portfolio.
 *
 * The Umami tracker script is injected in `src/routes/__root.tsx` with
 * production defaults (`https://unami.rega.run` +
 * `40d976e9-29ab-42b6-a777-b3a126a87e19`), overridable via `VITE_UMAMI_URL` /
 * `VITE_UMAMI_WEBSITE_ID`. `data-domains` restricts tracking to production,
 * so local dev, previews and forks never send events. All tracking calls
 * below are no-ops when the script is absent.
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
