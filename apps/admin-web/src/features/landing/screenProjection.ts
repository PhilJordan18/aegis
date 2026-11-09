import screen from '../../assets/landing/screen.json'

/** The hub screen is laid out in this design space, then projected onto the render. */
export const SCREEN_BOX = { width: 300, height: 200 } as const
/** Pixel size of the device renders the corners were measured on. */
export const RENDER_SIZE = { width: screen.image.width, height: screen.image.height } as const

export type Point = readonly [number, number]
/** Top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point]

const [c0, c1, c2, c3] = screen.corners
const RENDER_CORNERS: Quad = [toPoint(c0), toPoint(c1), toPoint(c2), toPoint(c3)]

function toPoint(value: number[] | undefined): Point {
  const [x, y] = value ?? []
  if (x === undefined || y === undefined) throw new Error('screen.json needs four [x, y] corners')
  return [x, y]
}

/**
 * CSS `matrix3d` taking the 300 × 200 screen box onto `quad`: the closed-form square-to-quadrilateral
 * projection (Heckbert, 1989), composed with the scale from the box to the unit square.
 */
export function homography(quad: Quad): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  let g = 0
  let h = 0
  if (sx !== 0 || sy !== 0) {
    const dx1 = x1 - x2
    const dx2 = x3 - x2
    const dy1 = y1 - y2
    const dy2 = y3 - y2
    const den = dx1 * dy2 - dx2 * dy1
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
  }
  const a = (x1 - x0 + g * x1) / SCREEN_BOX.width
  const b = (x3 - x0 + h * x3) / SCREEN_BOX.height
  const d = (y1 - y0 + g * y1) / SCREEN_BOX.width
  const e = (y3 - y0 + h * y3) / SCREEN_BOX.height
  const columns = [a, d, 0, g / SCREEN_BOX.width, b, e, 0, h / SCREEN_BOX.height, 0, 0, 1, 0, x0, y0, 0, 1]
  // Full precision: the perspective terms are tiny, and rounding them moves the far corners visibly.
  return `matrix3d(${columns.join(',')})`
}

/**
 * The screen corners of screen.json scaled to a render shown `renderedWidth` px wide. The render fills
 * its box exactly (same aspect ratio), so one scale factor applies to both axes.
 */
export function screenQuad(renderedWidth: number): Quad {
  const k = renderedWidth / RENDER_SIZE.width
  const [p0, p1, p2, p3] = RENDER_CORNERS.map(([x, y]): Point => [x * k, y * k]) as unknown as Quad
  return [p0, p1, p2, p3]
}

export function quadCenter([[x0, y0], , [x2, y2]]: Quad): Point {
  return [(x0 + x2) / 2, (y0 + y2) / 2]
}
