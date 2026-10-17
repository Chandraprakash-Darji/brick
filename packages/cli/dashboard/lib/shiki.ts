import { createShikiFactory } from "fumadocs-core/highlight/shiki";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import bash from "shiki/langs/bash.mjs";
import csharp from "shiki/langs/csharp.mjs";
import go from "shiki/langs/go.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import typescript from "shiki/langs/typescript.mjs";
import xml from "shiki/langs/xml.mjs";
import yaml from "shiki/langs/yaml.mjs";

/**
 * The highlighter of the API reference: the languages its code samples and
 * responses use, and no others. The build points
 * `fumadocs-core/highlight/shiki/full` here (see vite.config.ts), because that
 * module would otherwise add every Shiki language and theme to the dashboard.
 * Any other language shows as plain text.
 */
const factory = createShikiFactory({
  init: (options) =>
    createHighlighterCore({
      langs: [
        bash,
        csharp,
        go,
        java,
        javascript,
        json,
        python,
        rust,
        typescript,
        xml,
        yaml,
      ],
      themes: [githubLight, githubDark],
      langAlias: options?.langAlias,
      engine: createJavaScriptRegexEngine(),
    }),
});

export const defaultShikiFactory = factory;
export const wasmShikiFactory = factory;
