import { describe, expect, it } from 'vitest'
import { homography, quadCenter, RENDER_SIZE, SCREEN_BOX, screenQuad, type Quad } from './screenProjection'

function apply(matrix: string, x: number, y: number): [number, number] {
  const m = matrix.slice('matrix3d('.length, -1).split(',').map(Number)
  const at = (i: number) => m[i] ?? Number.NaN
  const w = at(3) * x + at(7) * y + at(15)
  return [(at(0) * x + at(4) * y + at(12)) / w, (at(1) * x + at(5) * y + at(13)) / w]
}

describe('hub screen projection', () => {
  it('takes each corner of the screen box onto the measured corner of the render', () => {
    const quad = screenQuad(RENDER_SIZE.width)
    const matrix = homography(quad)
    const box: [number, number][] = [
      [0, 0],
      [SCREEN_BOX.width, 0],
      [SCREEN_BOX.width, SCREEN_BOX.height],
      [0, SCREEN_BOX.height],
    ]
    box.forEach(([x, y], i) => {
      const [u, v] = apply(matrix, x, y)
      expect(u).toBeCloseTo(quad[i]?.[0] ?? Number.NaN, 6)
      expect(v).toBeCloseTo(quad[i]?.[1] ?? Number.NaN, 6)
    })
  })

  it('scales the corners with the rendered width', () => {
    const full = screenQuad(RENDER_SIZE.width)
    const half = screenQuad(RENDER_SIZE.width / 2)
    expect(half[2][0]).toBeCloseTo(full[2][0] / 2, 6)
    expect(half[2][1]).toBeCloseTo(full[2][1] / 2, 6)
  })

  it('reduces to a plain scale and offset for a rectangle', () => {
    const rectangle: Quad = [
      [10, 20],
      [610, 20],
      [610, 420],
      [10, 420],
    ]
    expect(homography(rectangle)).toBe('matrix3d(2,0,0,0,0,2,0,0,0,0,1,0,10,20,0,1)')
    expect(quadCenter(rectangle)).toEqual([310, 220])
  })
})
