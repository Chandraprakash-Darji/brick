import { copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";

// Bundles the React dashboard (dashboard/) into dashboard-dist/, which the
// package ships and `brick dev` serves. kit.js, the UI kit extensions import
// as `@brickkit/cli/dashboard`, is a second entry of the same build.
await build({
  configFile: fileURLToPath(
    new URL("../dashboard/vite.config.ts", import.meta.url),
  ),
  logLevel: "warn",
});

// The project's own docs components and dashboard extension import React by
// name. These modules, named in the page's import map, hand them the
// dashboard's copy (see main.tsx).
const out = (name: string) =>
  fileURLToPath(new URL(`../dashboard-dist/${name}`, import.meta.url));
const shim = (module: object, global: string) => {
  const names = Object.keys(module).filter(
    (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
  );
  return `const module = globalThis.__brickDashboard.${global};
export default module;
export const { ${names.join(", ")} } = module;
`;
};
await writeFile(out("react.js"), shim(React, "React"));
await writeFile(out("react-dom.js"), shim(ReactDOM, "ReactDOM"));
await writeFile(
  out("react-dom-client.js"),
  shim(ReactDOMClient, "ReactDOMClient"),
);
await writeFile(
  out("react-jsx-runtime.js"),
  `const runtime = globalThis.__brickDashboard.jsxRuntime;
export const { Fragment, jsx, jsxs } = runtime;
// Components built in development mode call jsxDEV, which production React lacks.
export const jsxDEV = (type, props, key) => runtime.jsx(type, props, key);
`,
);
// The CLI compiles an extension's Tailwind classes against the same tokens.
await copyFile(
  fileURLToPath(new URL("../dashboard/theme.css", import.meta.url)),
  out("theme.css"),
);
console.log("Dashboard built into dashboard-dist/");
