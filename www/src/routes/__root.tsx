import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import * as React from "react";
import appCss from "@/styles/app.css?url";
import { RootProvider } from "@fumadocs/base-ui/provider/tanstack";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { site } from "@/lib/site";

export const Route = createRootRoute({
  head: () => {
    // Umami analytics (self-hosted on Vercel), mirroring
    // Chandraprakash-Darji/portfolio (`@yeskunall/astro-umami` with
    // endpointUrl/hostUrl). Only include the tracker when both env vars are
    // set, so local dev, previews and forks send nothing. Set these in the
    // www Vercel project (Production only). See www/README.md.
    // Umami's tracker watches the History API, so TanStack Router
    // client-side navigation is recorded automatically — no manual
    // `umami.track()` on route change (that would double-count pageviews).
    const umamiUrl = (
      import.meta.env.VITE_UMAMI_URL as string | undefined
    )?.replace(/\/$/, "");
    const umamiWebsiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as
      | string
      | undefined;
    // Optional proxy: set VITE_UMAMI_HOST_URL to the Umami instance and serve
    // the script through our own domain (`/stats/script.js`) so ad blockers
    // don't drop events. When unset, events go directly to VITE_UMAMI_URL.
    const umamiHostUrl = (
      import.meta.env.VITE_UMAMI_HOST_URL as string | undefined
    )?.replace(/\/$/, "");

    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: site.title,
        },
        {
          name: "description",
          content: site.description,
        },
        {
          property: "og:title",
          content: site.title,
        },
        {
          property: "og:description",
          content: site.description,
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/svg+xml", href: "/brand/logo.svg" },
      ],
      scripts:
        umamiUrl && umamiWebsiteId
          ? [
              {
                defer: true,
                src: `${umamiUrl}/script.js`,
                "data-website-id": umamiWebsiteId,
                "data-domains": new URL(site.url).hostname,
                ...(umamiHostUrl ? { "data-host-url": umamiHostUrl } : {}),
              },
            ]
          : [],
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isDocs = pathname.startsWith("/docs");
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <RootProvider>
          {isDocs ? (
            <div className="brick-site brick-docs-site flex min-h-svh flex-col">
              <Outlet />
            </div>
          ) : (
            <div className="brick-site flex min-h-svh flex-col">
              <SiteHeader />
              <div className="frame flex flex-1 flex-col">
                <Outlet />
              </div>
              <SiteFooter />
            </div>
          )}
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
