import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { TailwindIndicator } from "@/components/TailwindIndicator";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/query-client";

import "@/styles.css";

// Pre-paint theme restore (mirror of `app/src/layouts/BaseLayout.astro`).
// Runs before first paint so the stored theme (`theme` key, dark default)
// applies without a flash. `<html>` is hard-coded `class="dark"` below;
// this only removes it when the user explicitly stored `"light"`.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"){document.documentElement.classList.remove("dark");}}catch(e){}})();`;

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Pages" },
    ],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster position="top-center" />
        <TailwindIndicator />
        {import.meta.env.DEV && (
          <>
            <TanStackDevtools
              config={{ hideUntilHover: true }}
              eventBusConfig={{ debug: true }}
              plugins={[{ ...formDevtoolsPlugin(), defaultOpen: true }]}
            />
            <ReactQueryDevtools initialIsOpen={false} />
          </>
        )}
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `dark` default matches the old BaseLayout (`<html class="dark">`);
    // the blocking head script above removes it pre-paint for light users.
    // Theme state itself lives in `hooks/use-theme.ts` (single source).
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
