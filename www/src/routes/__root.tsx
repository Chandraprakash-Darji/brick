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
  head: () => ({
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
  }),
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
