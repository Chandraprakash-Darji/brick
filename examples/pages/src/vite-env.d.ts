/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the Go backend API (e.g. "" when proxied via /api in dev). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
