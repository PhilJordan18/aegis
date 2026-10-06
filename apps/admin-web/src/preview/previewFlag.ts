/**
 * Decides at build time whether the design-review preview is compiled in:
 * the dev server always, `vite build` only with VITE_AEGIS_PREVIEW=true
 * (`npm run build:preview`). vite.config.ts injects the result as the literal
 * `__AEGIS_PREVIEW__`, so `if (__AEGIS_PREVIEW__)` branches and their dynamic
 * imports disappear from a production build before chunking. An imported
 * boolean constant is not enough: Rolldown still emits the dead chunks.
 * scripts/check-preview-excluded.mjs verifies the result after every build.
 */
export function isPreviewEnabled({ command, previewVariable }: { command: 'serve' | 'build'; previewVariable: string | undefined }): boolean {
  return command === 'serve' || previewVariable === 'true'
}
