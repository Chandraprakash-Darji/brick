import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { FileText, LayoutGrid, LogOut, Plus } from "lucide-react";
import { useEffect } from "react";

import { pageCollection } from "@/collections/pages";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  setCommandBarOpen,
  toggleCommandBar,
  useCommandBar,
} from "@/hooks/use-command-bar";
import { signOut } from "@/lib/auth";

export interface CommandBarPage {
  id: string;
  slug: string;
  title: string;
}

export function CommandBar({ pages: pagesProp }: { pages?: CommandBarPage[] }) {
  const { open, setOpen } = useCommandBar();
  const navigate = useNavigate();

  const liveQuery = useLiveQuery((q) => q.from({ page: pageCollection }));
  const pages: CommandBarPage[] =
    pagesProp ??
    liveQuery.data?.map((page) => ({
      id: page.id,
      title: page.title ?? "",
      slug: page.slug ?? "",
    })) ??
    [];

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCommandBar();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  function goDashboard() {
    setOpen(false);
    void navigate({ to: "/dashboard" });
  }

  function goNewPage() {
    setOpen(false);
    void navigate({ to: "/editor" });
  }

  function goPage(page: CommandBarPage) {
    setOpen(false);
    void navigate({ params: { id: page.id }, to: "/editor/$id" });
  }

  function handleSignOut() {
    setOpen(false);
    void signOut();
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setCommandBarOpen}
      title="Quick find"
      description="Search pages or run an action"
    >
      <CommandInput placeholder="Search pages or type a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Pages">
          {pages.map((page) => (
            <CommandItem
              key={page.id}
              value={`${page.title} ${page.slug}`}
              onSelect={() => goPage(page)}
            >
              <FileText className="text-muted-foreground" />
              <span className="flex-1 truncate">{page.title}</span>
              <span className="font-mono text-xs text-muted-foreground opacity-60">
                /{page.slug}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="new page create" onSelect={goNewPage}>
            <Plus />
            New Page
          </CommandItem>
          <CommandItem value="dashboard my pages" onSelect={goDashboard}>
            <LayoutGrid />
            Dashboard
          </CommandItem>
          <CommandItem value="sign out logout" onSelect={handleSignOut}>
            <LogOut />
            Sign Out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
