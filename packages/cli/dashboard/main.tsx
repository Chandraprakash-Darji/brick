import * as React from "react";
import { StrictMode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import "./styles.css";

// The project's own docs components are bundled apart from the dashboard and
// import React by name; the page's import map points those at this copy, so
// there is one React on the page. See scripts/build-dashboard.ts.
Object.assign(globalThis, { __brickDocs: { React, jsxRuntime } });

const root = document.getElementById("root");
if (!root) throw new Error("Brick dashboard: missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
