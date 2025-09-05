/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENTS_BASE_URL: string
  readonly VITE_AGENTS_AUTH_BEARER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
