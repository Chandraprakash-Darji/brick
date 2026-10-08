import type { ReactNode } from "react";

export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex w-full items-center">
      <div className="w-full border-t" />
      <div className="flex w-max justify-center px-2 font-mono text-[10px] tracking-widest text-nowrap text-muted-foreground uppercase">
        {children}
      </div>
      <div className="w-full border-t" />
    </div>
  );
}
