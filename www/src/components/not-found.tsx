import { HomeLayout } from "fumadocs-ui/layouts/home";
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found";

import { baseOptions, links } from "@/lib/layout.shared";

export function NotFound() {
  return (
    <HomeLayout {...baseOptions()} links={links}>
      <DefaultNotFound />
    </HomeLayout>
  );
}
