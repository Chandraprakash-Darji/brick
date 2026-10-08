import { useSyncExternalStore } from "react";

// Module-level open flag shared across all callers.
// Mirrors the module-level `ref` in app/src/composables/useCommandBar.ts.
let open = false;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  return open;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function setCommandBarOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  emit();
}

export function toggleCommandBar(): void {
  setCommandBarOpen(!open);
}

export function useCommandBar(): {
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
} {
  const isOpen = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return { open: isOpen, setOpen: setCommandBarOpen, toggle: toggleCommandBar };
}
