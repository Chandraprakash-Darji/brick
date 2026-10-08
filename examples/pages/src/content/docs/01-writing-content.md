---
title: Writing Content
description: Markdown and HTML editing guide
---

## Markdown

pages·dev uses GitHub Flavored Markdown via [marked](https://marked.js.org/). All standard GFM features are supported.

### Headings

```markdown
# Heading 1

## Heading 2

### Heading 3
```

### Code blocks

With language annotation for syntax highlighting:

````markdown
```javascript
const hello = "world";
```
````

````

### Tables

```markdown
| Feature | Supported |
|---------|-----------|
| Tables  | Yes       |
| Lists   | Yes       |
````

### Task lists

```markdown
- [x] Done
- [ ] Not done
```

## HTML

Switch to HTML mode for full control. The HTML is rendered in a sandboxed iframe with `allow-scripts` enabled.

## Themes

When publishing Markdown, choose from several syntax highlighting themes:

- **Dracula** — dark, high contrast
- **GitHub Dark** — familiar dark mode
- **GitHub Light** — familiar light mode
- **Nord** — muted blue-gray palette
