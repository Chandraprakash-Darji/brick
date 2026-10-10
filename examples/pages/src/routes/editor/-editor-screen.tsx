import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Columns2, Expand, PanelLeft, PanelRight, X } from "lucide-react";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { createPageAction, updatePageAction } from "@/actions/pages";
import { pageApi, type PageCreateInput } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";

import { useRequireAuth } from "../-guards";

import "./-editor.css";

// Same derivation as app/src/routes/editor/[[id]].vue.
type ContentType = NonNullable<PageCreateInput["contentType"]>;
type Theme = NonNullable<PageCreateInput["theme"]>;
type ViewMode = "editor" | "split" | "preview";

const THEMES: { label: string; value: Theme }[] = [
  { label: "Dracula", value: "dracula" },
  { label: "GitHub Dark", value: "github-dark" },
  { label: "GitHub Light", value: "github-light" },
  { label: "Nord", value: "nord" },
];

interface EditorScreenProps {
  pageId?: string;
}

/**
 * Shared new/edit form behind editor/index.tsx (new) and editor/$id.tsx
 * (edit). Port of app/src/routes/editor/[[id]].vue: typed pageApi.get for
 * loading, createPageAction/updatePageAction for saves.
 */
export function EditorScreen({ pageId }: EditorScreenProps) {
  const router = useRouter();
  useRequireAuth();

  const isEditing = !!pageId;

  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState<ContentType>("markdown");
  const [fullscreen, setFullscreen] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState<Theme>("github-dark");
  const [title, setTitle] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  const pageQuery = useQuery({
    enabled: isEditing,
    queryFn: () => pageApi.get({ id: pageId as string }),
    queryKey: ["page", pageId],
  });
  const page = pageQuery.data;

  // Populate the form once the page loads (mirrors watch(pageId, immediate)).
  useEffect(() => {
    if (!page) return;
    setContent(page.content);
    setContentType(page.contentType);
    setIsPublic(page.isPublic);
    setSlug(page.slug);
    setTheme(page.theme);
    setTitle(page.title);
  }, [page]);

  // New page (no id) -> reset the form (mirrors watch(pageId, immediate)
  // else-branch; editor/$id.tsx also remounts via key={id}).
  useEffect(() => {
    if (!pageId) {
      setContent("");
      setContentType("markdown");
      setIsPublic(false);
      setSlug("");
      setTheme("github-dark");
      setTitle("");
    }
  }, [pageId]);

  // Missing page -> toast + back to dashboard (mirrors loadPage: a 200 with
  // empty data counts as not-found, same as a query error).
  useEffect(() => {
    if (!isEditing) return;
    if (pageQuery.isError || (pageQuery.isSuccess && !pageQuery.data)) {
      toast.error("Page not found");
      router.history.push("/dashboard");
    }
  }, [
    isEditing,
    pageQuery.data,
    pageQuery.isError,
    pageQuery.isSuccess,
    router,
  ]);

  const previewHtml = useMemo(() => {
    if (contentType === "html") return content;
    return marked.parse(content) as string;
  }, [content, contentType]);

  function generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || "untitled"
    );
  }

  function onTitleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setTitle(val);
    if (!isEditing) {
      setSlug(generateSlug(val));
    }
  }

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape" && fullscreen) setFullscreen(false);
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [fullscreen]);

  async function savePage() {
    if (!slug || !title) {
      toast.error("Title and slug are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        content,
        contentType: contentType,
        isPublic: isPublic,
        slug,
        theme,
        title,
      };
      if (isEditing && pageId) {
        await updatePageAction({ id: pageId, ...body }).isPersisted.promise;
        toast.success("Page updated");
      } else {
        await createPageAction(body).isPersisted.promise;
        toast.success("Page created");
      }
      router.history.push("/dashboard");
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="editor">
        {/* Topbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <h1 className="text-lg font-semibold tracking-tight">
              {isEditing ? "Edit page" : "New page"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFullscreen(true)}
            >
              <Expand className="size-3.5" />
              Preview
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard">Cancel</Link>
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void savePage()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Details card */}
        <section className="editor-card tui-panel relative">
          <span className="tui-title">details</span>
          <div className="mb-4">
            <p className="font-mono text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              Details
            </p>
            <p className="text-xs text-muted-foreground">
              Title, slug, and publishing settings.
            </p>
          </div>

          <div className="field-grid">
            <div className="field field--span2">
              <Label htmlFor="ed-title">Title</Label>
              <Input
                id="ed-title"
                placeholder="My awesome page"
                type="text"
                value={title}
                onChange={onTitleInput}
              />
            </div>

            <div className="field">
              <Label htmlFor="ed-slug">Slug</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                  /
                </span>
                <Input
                  id="ed-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="pl-5"
                  placeholder="my-page"
                  type="text"
                />
              </div>
            </div>

            <div className="field">
              <Label>Content type</Label>
              <Select
                value={contentType}
                onValueChange={(v: string) => setContentType(v as ContentType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="markdown">Markdown</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {contentType === "markdown" && (
              <div className="field">
                <Label>Theme</Label>
                <Select
                  value={theme}
                  onValueChange={(v: string) => setTheme(v as Theme)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THEMES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <p className="text-sm font-medium">Public</p>
              <p className="text-xs text-muted-foreground">
                Anyone with the link can view this page.
              </p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </section>

        {/* Content + Preview */}
        <section className="editor-card tui-panel relative">
          <span className="tui-title">content</span>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                Content
              </p>
              <p className="text-xs text-muted-foreground">
                {contentType === "markdown"
                  ? "GitHub Flavored Markdown — tables, task lists, mermaid diagrams supported."
                  : "Raw HTML."}
              </p>
            </div>

            {/* View mode toggle */}
            <div className="view-toggle">
              <button
                className={`view-btn ${viewMode === "editor" ? "view-btn--active" : ""}`}
                title="Editor only"
                onClick={() => setViewMode("editor")}
              >
                <PanelLeft className="size-3.5" />
              </button>
              {/* Columns2 is the split-view glyph (old ColumnsIcon); intentional. */}
              <button
                className={`view-btn ${viewMode === "split" ? "view-btn--active" : ""}`}
                title="Split view"
                onClick={() => setViewMode("split")}
              >
                <Columns2 className="size-3.5" />
              </button>
              <button
                className={`view-btn ${viewMode === "preview" ? "view-btn--active" : ""}`}
                title="Preview only"
                onClick={() => setViewMode("preview")}
              >
                <PanelRight className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Keep-mounted panes (hidden class, not unmount) so the textarea
              keeps focus/undo state across view-mode switches (old v-show). */}
          <div className="split-pane" data-view={viewMode}>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={`split-editor${viewMode === "preview" ? " hidden" : ""}`}
              placeholder={
                contentType === "markdown"
                  ? "# Hello world\n\nWrite your markdown here…"
                  : "<!DOCTYPE html>\n<html>…</html>"
              }
            />
            <div
              className={`split-divider${viewMode === "split" ? "" : " hidden"}`}
            />
            <div
              className={`split-preview${viewMode === "editor" ? " hidden" : ""}`}
            >
              {contentType === "markdown" ? (
                <div
                  className="preview-body"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <iframe
                  className="preview-frame"
                  sandbox="allow-scripts"
                  srcDoc={previewHtml}
                  title="HTML preview"
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Full-screen preview (old Teleport to="body"). */}
      {fullscreen &&
        createPortal(
          <div className="fs-overlay" onClick={() => setFullscreen(false)}>
            <div
              className="fs-panel tui-panel relative"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="tui-title">preview</span>
              <div className="fs-topbar">
                <span className="fs-title font-mono text-xs">
                  {title || "Preview"}
                </span>
                <button
                  className="fs-close"
                  title="Close (Esc)"
                  onClick={() => setFullscreen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="fs-body">
                {contentType === "markdown" ? (
                  <div
                    className="preview-body fs-prose"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <iframe
                    className="preview-frame"
                    sandbox="allow-scripts"
                    srcDoc={previewHtml}
                    title="HTML preview"
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </AppShell>
  );
}
