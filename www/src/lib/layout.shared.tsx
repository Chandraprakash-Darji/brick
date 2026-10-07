import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";

import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    nav: {
      title: appName,
    },
  };
}
export const links: LinkItemType[] = [
  {
    active: "url",
    text: "Docs",
    url: "/docs",
  },
  {
    active: "url",
    text: "CLI",
    url: "/docs/brick-cli",
  },
  {
    active: "url",
    text: "Extensions",
    url: "/docs/plugins",
  },
];
