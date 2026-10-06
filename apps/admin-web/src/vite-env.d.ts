/// <reference types="vite/client" />

/** Build-time literal from vite.config.ts (see src/preview/previewFlag.ts). Never true in production. */
declare const __AEGIS_PREVIEW__: boolean

interface ImportMetaEnv {
  /** `'true'` compiles the design-review preview into `vite build`. Never set in production. */
  readonly VITE_AEGIS_PREVIEW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
