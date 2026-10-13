import { SquarePenIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/analytics";
import { gitConfig, repoUrl } from "@/lib/shared";

export function EditOnGitHub({
  path,
  className,
  onClick,
  ...props
}: { path: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={`${repoUrl}/edit/${gitConfig.branch}/${path}`}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        onClick?.(e);
        trackEvent("docs-edit-github", { path });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      <SquarePenIcon className="size-3.5 shrink-0" />
      Edit this page on GitHub
    </a>
  );
}
