import type { ReactNode } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

import { AppSidebar } from "./AppSidebar";
import { CommandBar } from "./CommandBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <div className="flex h-svh flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
          <footer className="tui-statusbar flex items-center justify-between gap-2 border-t px-4 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <span>pages</span>
            <span>theme: dark</span>
          </footer>
        </div>
      </SidebarInset>
      <CommandBar />
    </SidebarProvider>
  );
}
