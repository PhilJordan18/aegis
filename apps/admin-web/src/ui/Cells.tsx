/**
 * Decorative compartment grid, hidden from assistive technology (handoff §0.8, review R1).
 * Two layers with the same geometry: the line grid (masked by the page CSS) and an
 * unmasked overlay holding only the lit cell, so the light is never dulled or half-faded.
 * `lit` is the cell from 768 px up, `litCompact` below (null: no light below 768 px).
 */
export function Cells({
  count,
  lit,
  litCompact,
  className,
}: {
  readonly count: number
  readonly lit: number
  readonly litCompact: number | null
  readonly className: string
}) {
  const cells = Array.from({ length: count }, (_, index) => index)
  return (
    <>
      <div className={`ag-cells ag-decor ${className}`} aria-hidden="true">
        {cells.map((index) => (
          <i key={index} />
        ))}
      </div>
      <div className={`ag-cells ag-cells--lit ag-decor ${className}`} aria-hidden="true" data-lit-layer="">
        {cells.map((index) => (
          <i
            key={index}
            className={[index === lit && 'is-lit-wide', index === litCompact && 'is-lit-compact'].filter(Boolean).join(' ') || undefined}
          />
        ))}
      </div>
    </>
  )
}
