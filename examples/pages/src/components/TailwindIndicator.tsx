import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";

export function TailwindIndicator() {
  const { isDark, toggleTheme } = useTheme();

  if (!import.meta.env.DEV) return null;

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[1000] flex items-center gap-2">
      <button
        className="pointer-events-auto flex items-center justify-center rounded-none border border-white/20 bg-[#04284A] p-2 text-white shadow-[0_10px_30px_rgba(4,40,74,0.25)] backdrop-blur-sm transition-opacity hover:opacity-80"
        aria-label="Toggle dark mode"
        onClick={toggleTheme}
      >
        {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>
      <div className="rounded-none border border-white/20 bg-[#04284A] px-3 py-2 font-mono text-[10px] font-medium tracking-widest text-white uppercase shadow-[0_10px_30px_rgba(4,40,74,0.25)] backdrop-blur-sm">
        <span className="block sm:hidden">xs</span>
        <span className="hidden sm:block md:hidden">sm</span>
        <span className="hidden md:block lg:hidden">md</span>
        <span className="hidden lg:block xl:hidden">lg</span>
        <span className="hidden xl:block 2xl:hidden">xl</span>
        <span className="hidden 2xl:block">2xl</span>
      </div>
    </div>
  );
}
