import { SquarePenIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { gitConfig, repoUrl } from "@/lib/shared";

export function EditOnGitHub({
  path,
  className,
  ...props
}: { path: string } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={`${repoUrl}/edit/${gitConfig.branch}/${path}`}
      target="_blank"
      rel="noreferrer noopener"
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
