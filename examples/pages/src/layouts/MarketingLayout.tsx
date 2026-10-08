import { useEffect } from "react";
import type { ReactNode } from "react";

import { useTheme } from "@/hooks/use-theme";

interface MarketingLayoutProps {
  title?: string;
  children: ReactNode;
}

/**
 * Port of app/src/layouts/BaseLayout.astro.
 * Dark default, sets document.title, and renders the portfolio-style
 * theme toggle.
 *
 * Theme state is owned by `hooks/use-theme.ts` (single source; `theme`
 * localStorage key, dark default). The pre-paint blocking script in
 * `routes/__root.tsx` already restores the stored theme before first
 * paint, so no mount-time class fixup is needed here.
 */
export function MarketingLayout({ title, children }: MarketingLayoutProps) {
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    document.body.classList.add("marketing");
    return () => {
      document.body.classList.remove("marketing");
    };
  }, []);

  return (
    <div className="min-h-svh bg-background font-sans text-foreground antialiased">
      {children}

      {/* Theme toggle (portfolio-style circular swatch) */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        aria-pressed={isDark}
        className="fixed right-5 bottom-5 z-50 h-5 w-5 rounded-none border-2 border-muted-foreground bg-foreground transition-transform hover:scale-110"
      />

      <style>{`
        /* Animated rose underline for prose links inside docs. */
        body.marketing .prose a {
          background-image: linear-gradient(
            to right,
            hsl(var(--primary)),
            hsl(var(--primary))
          );
          background-position: 0 100%;
          background-repeat: no-repeat;
          background-size: 0 2px;
          transition: background-size 0.25s ease;
        }
        body.marketing .prose a:hover {
          background-size: 100% 2px;
        }

        body.marketing ::selection {
          background: color-mix(in oklch, hsl(var(--primary)) 30%, transparent);
        }
      `}</style>
    </div>
  );
}
