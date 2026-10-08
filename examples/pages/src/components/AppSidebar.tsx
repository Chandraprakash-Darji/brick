import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, LogOut, Plus, Search } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useCommandBar } from "@/hooks/use-command-bar";
import { signOut, useSession } from "@/lib/auth";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const session = useSession();
  const { toggle: openCommandBar } = useCommandBar();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-2">
        <span className="px-2 pt-1 font-mono text-[13px] font-bold tracking-tight text-foreground">
          pages<span className="text-primary">·</span>dev
        </span>

        {/* User info: now at the top of the sidebar. */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-none bg-primary text-[10px] font-semibold text-primary-foreground">
                {session.data?.user.name
                  ? initials(session.data.user.name)
                  : "?"}
              </div>
              <div className="grid flex-1 leading-tight">
                <span className="truncate text-xs font-medium">
                  {session.data?.user.name ?? "User"}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {session.data?.user.email ?? ""}
                </span>
              </div>
            </SidebarMenuButton>
            <SidebarMenuAction title="Sign out" onClick={() => void signOut()}>
              <LogOut strokeWidth={1.75} />
            </SidebarMenuAction>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="text-muted-foreground"
                  onClick={openCommandBar}
                >
                  <Search size={15} strokeWidth={1.75} />
                  <span className="flex-1">Quick find…</span>
                  <kbd className="rounded-none border bg-background px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                    ⌘K
                  </kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/dashboard"}>
                  <Link to="/dashboard">
                    <LayoutGrid size={15} strokeWidth={1.75} />
                    <span>Pages</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith("/editor")}
                >
                  <Link to="/editor">
                    <Plus size={15} strokeWidth={1.75} />
                    <span>New Page</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
