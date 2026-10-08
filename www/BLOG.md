# Publishing on the BrickKit blog

The blog lives at `/blog`. Posts are MDX files in `content/blog`; the filename
becomes the URL slug. Keep posts directly in this directory.

Create a file such as `content/blog/brickkit-v0-3-0.mdx`:

```md
---
title: "BrickKit v0.3.0: describe the main changes"
description: "A short summary for the blog index and search previews."
date: "2026-10-09"
category: release
version: "0.3.0"
author: "BrickKit team"
---

Explain what changed, show the new APIs, and include upgrade instructions.
```

Use `category: release` for framework upgrades and `category: guide` for articles
about building with BrickKit. `version` and `author` are optional; the author
defaults to `BrickKit team`. Dates use `YYYY-MM-DD`. The collection validates
metadata during content generation. Posts appear newest first, with a stable
slug order for posts published on the same day.

For each framework release, add a post covering the previous and new versions,
public API changes, before/after examples, breaking changes, migration steps,
and links to the release and relevant docs. Guide posts should identify the
framework version used by their examples.

Use fenced code blocks with language names for syntax highlighting. Link to
documentation with `/docs/...` URLs. Adding a file automatically adds it to the
index; no registry or route edits are needed.

From the repository root, verify content and build the site:

```sh
bun run --cwd www types:check
bun run --cwd www build
```

Commit the post with the site changes and deploy the website to publish it.
The npm release workflow does not write or publish blog posts automatically.
