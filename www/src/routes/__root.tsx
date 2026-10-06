import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import * as React from 'react';
import appCss from '@/styles/app.css?url';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { site } from '@/lib/site';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: site.title,
      },
      {
        name: 'description',
        content: site.description,
      },
      {
        property: 'og:title',
        content: site.title,
      },
      {
        property: 'og:description',
        content: site.description,
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <RootProvider>
          <div className="flex min-h-svh flex-col">
            <SiteHeader />
            <div className="frame flex flex-1 flex-col">
              <Outlet />
            </div>
            <SiteFooter />
          </div>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
