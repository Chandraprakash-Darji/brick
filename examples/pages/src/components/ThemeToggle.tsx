import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggleTheme}
    >
      {isDark ? (
        <Moon size={15} strokeWidth={1.75} />
      ) : (
        <Sun size={15} strokeWidth={1.75} />
      )}
    </Button>
  );
}
