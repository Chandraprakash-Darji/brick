import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { App } from "@/app";
import { loadExtension } from "@/extension";
import "./styles.css";

// The project's own modules (docs components, the dashboard extension) are
// bundled apart from the dashboard and import React by name; the page's import
// map points those at this copy, so there is one React on the page. See
// scripts/build-dashboard.ts.
Object.assign(globalThis, {
  __brickDashboard: { React, ReactDOM, ReactDOMClient, jsxRuntime },
});

const root = document.getElementById("root");
if (!root) throw new Error("Brick dashboard: missing #root element");
// The extension loads first, so its root and pages are there from the start.
void loadExtension().then((loaded) =>
  ReactDOMClient.createRoot(root).render(
    <StrictMode>
      <App loaded={loaded} />
    </StrictMode>,
  ),
);
