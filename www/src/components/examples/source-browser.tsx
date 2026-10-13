import { ArrowUpRightIcon, FileIcon, FolderIcon } from "lucide-react";
import * as React from "react";
import { SourceCode } from "@/components/source-code";
import {
  exampleGitHubUrl,
  loadExampleSources,
  type ExampleSource,
} from "@/lib/examples";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: ExampleSource;
}

function buildTree(files: ExampleSource[]) {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    let node = root;
    const parts = file.path.split("/");
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path, children: new Map() });
      }
      node = node.children.get(part)!;
    });
    node.file = file;
  }
  return root;
}

const sortNodes = (nodes: Iterable<TreeNode>) =>
  [...nodes].sort(
    (a, b) =>
      Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name),
  );

function Tree({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}) {
  return (
    <ul>
      {sortNodes(node.children.values()).map((child) => {
        const indent = { paddingLeft: `${depth * 12 + 8}px` };
        if (child.file) {
          return (
            <li key={child.path}>
              <button
                type="button"
                style={indent}
                onClick={() => onSelect(child.path)}
                className={cn(
                  "flex w-full items-center gap-2 truncate rounded py-1 pr-2 text-left font-mono text-xs transition-colors hover:bg-muted",
                  selected === child.path && "bg-muted font-medium",
                )}
              >
                <FileIcon className="size-3 shrink-0 text-muted-foreground" />
                {child.name}
              </button>
            </li>
          );
        }
        return (
          <li key={child.path}>
            <details open={depth < 1 || selected.startsWith(`${child.path}/`)}>
              <summary
                style={indent}
                className="flex cursor-pointer items-center gap-2 py-1 pr-2 font-mono text-xs text-muted-foreground"
              >
                <FolderIcon className="size-3 shrink-0" />
                {child.name}
              </summary>
              <Tree
                node={child}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/** File tree plus syntax-highlighted source for one example. */
export function SourceBrowser({
  slug,
  entry,
}: {
  slug: string;
  entry: string;
}) {
  const [files, setFiles] = React.useState<ExampleSource[]>();
  const [selected, setSelected] = React.useState(entry);

  React.useEffect(() => {
    let active = true;
    void loadExampleSources(slug).then((loaded) => {
      if (active) setFiles(loaded);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  const tree = React.useMemo(() => files && buildTree(files), [files]);
  const file = files?.find((f) => f.path === selected) ?? files?.[0];

  if (!files || !tree) {
    return <p className="text-sm text-muted-foreground">Loading source…</p>;
  }

  return (
    <div className="grid overflow-hidden rounded-lg border md:grid-cols-[260px_1fr]">
      <nav
        aria-label="Files"
        className="max-h-[560px] overflow-auto border-b bg-card p-2 md:border-r md:border-b-0"
      >
        <Tree
          node={tree}
          depth={0}
          selected={file?.path ?? ""}
          onSelect={setSelected}
        />
      </nav>
      {file && (
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 border-b px-4 py-2.5">
            <span className="truncate font-mono text-xs">{file.path}</span>
            <a
              href={exampleGitHubUrl(slug, file.path)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Open in GitHub <ArrowUpRightIcon className="size-3" />
            </a>
          </div>
          <div className="max-h-[520px] overflow-auto p-4">
            <SourceCode code={file.code} lang={file.lang} />
          </div>
        </div>
      )}
    </div>
  );
}
