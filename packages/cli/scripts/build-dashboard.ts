import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import * as React from "react";

// Bundles the React dashboard (dashboard/) into dashboard-dist/, which the
// package ships and `brick dev` serves.
await build({
  configFile: fileURLToPath(
    new URL("../dashboard/vite.config.ts", import.meta.url),
  ),
  logLevel: "warn",
});

// The project's own docs components import React by name. These modules, named
// in the page's import map, hand them the dashboard's copy (see main.tsx).
const out = (name: string) =>
  fileURLToPath(new URL(`../dashboard-dist/${name}`, import.meta.url));
const names = Object.keys(React).filter(
  (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name),
);
await writeFile(
  out("react.js"),
  `const React = globalThis.__brickDocs.React;
export default React;
export const { ${names.join(", ")} } = React;
`,
);
await writeFile(
  out("react-jsx-runtime.js"),
  `const runtime = globalThis.__brickDocs.jsxRuntime;
export const { Fragment, jsx, jsxs } = runtime;
// Components built in development mode call jsxDEV, which production React lacks.
export const jsxDEV = (type, props, key) => runtime.jsx(type, props, key);
`,
);
console.log("Dashboard built into dashboard-dist/");
