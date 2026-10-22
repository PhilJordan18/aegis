# Brand mark (provisional)

The two SVG files here are the symbol of the provisional Aegis Core identity, copied
without change from `docs/design/identite/assets/`:

| File | Use |
|---|---|
| `aegis-core-mark.svg` | Light appearance |
| `aegis-core-mark-dark.svg` | Dark appearance |

They are used only by `src/ui/Brand.tsx`, which shows one of them according to
`data-theme`, followed by the word « aegis » set in Geist and the application name
« Manager » as text. No geometry of the symbol is copied into code or CSS.

When the designer delivers the final assets, replace these two files (keep the names
and a square viewBox). Nothing else has to change; update the originals in
`docs/design/identite/assets/` in the same change. The full `aegis-core-logo*.svg`
signatures are not used in the application (their text is set in Inter, which the
application does not load).
