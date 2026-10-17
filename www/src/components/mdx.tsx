import defaultMdxComponents from "@fumadocs/base-ui/mdx";
import { CodeBlock, Pre } from "@fumadocs/base-ui/components/codeblock";
import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { DatabaseTable } from "./database-table";
import { Card, Cards } from "./card";

// Fumadocs caps each code block at 600px and scrolls inside it. On a phone that
// inner scroll takes over the page's swipe, so the block grows to its content
// instead. Long lines still scroll sideways.
function CodeBlockPre(props: ComponentProps<"pre">) {
  return (
    <CodeBlock {...props} viewportProps={{ className: "max-h-none" }}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    pre: CodeBlockPre,
    Tab,
    Tabs,
    Step,
    Steps,
    DatabaseTable,
    Card,
    Cards,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
