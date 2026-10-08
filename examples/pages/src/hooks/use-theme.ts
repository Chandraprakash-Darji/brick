import { useSyncExternalStore } from "react";

const THEME_STORAGE_KEY = "theme";

function readIsDark(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

// Shared subscription set so every useTheme() caller re-renders together.
// Mirrors the module-level `ref` in app/src/composables/useTheme.ts.
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function getSnapshot(): boolean {
  if (cached === null) cached = readIsDark();
  return cached;
}

function getServerSnapshot(): boolean {
  // Matches the Vue default (ref(true)) used before hydration.
  return true;
}

function emit(): void {
  cached = readIsDark();
  listeners.forEach((listener) => listener());
}

let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (
    listeners.size === 1 &&
    typeof document !== "undefined" &&
    typeof MutationObserver !== "undefined"
  ) {
    observer = new MutationObserver(emit);
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

export function setTheme(dark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // Storage may be unavailable (private mode, SSR); theme still applies.
  }
  emit();
}

export function toggleTheme(): void {
  setTheme(!readIsDark());
}

export function useTheme(): {
  isDark: boolean;
  setTheme: (dark: boolean) => void;
  toggleTheme: () => void;
} {
  const isDark = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return { isDark, setTheme, toggleTheme };
}
