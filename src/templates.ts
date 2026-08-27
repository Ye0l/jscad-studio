import type { ProjectTemplate } from './types'

export const TEMPLATE_LABELS: Record<ProjectTemplate, string> = {
  blank: '빈 프로젝트',
  keycap: '키캡 예제',
  plate: '60% 보강판 예제',
}

export const TEMPLATES: Record<ProjectTemplate, string> = {
  blank: `const { cuboid, cylinder } = require('@jscad/modeling').primitives
const { subtract } = require('@jscad/modeling').booleans

const main = () => {
  const body = cuboid({ size: [40, 40, 12] })
  const hole = cylinder({ radius: 6, height: 20, segments: 48 })
  return subtract(body, hole)
}

module.exports = { main }
`,
  keycap: `const { cuboid, roundedCuboid } = require('@jscad/modeling').primitives
const { subtract, union } = require('@jscad/modeling').booleans
const { translate } = require('@jscad/modeling').transforms
const { colorize } = require('@jscad/modeling').colors

// Cherry MX 호환 1u 키캡의 간단한 시작점 (단위: mm)
const main = () => {
  const outer = roundedCuboid({ size: [18.2, 18.2, 10], roundRadius: 1.2, segments: 24 })
  const inner = translate([0, 0, -1.4], roundedCuboid({
    size: [15.4, 15.4, 9.2], roundRadius: 0.8, segments: 20
  }))
  const shell = subtract(outer, inner)

  const stemOuter = translate([0, 0, -2.5], cuboid({ size: [5.5, 5.5, 5] }))
  const crossV = translate([0, 0, -2.5], cuboid({ size: [1.25, 4.1, 7] }))
  const crossH = translate([0, 0, -2.5], cuboid({ size: [4.1, 1.25, 7] }))
  const stem = subtract(stemOuter, union(crossV, crossH))

  return colorize([0.35, 0.76, 0.68, 1], union(shell, stem))
}

module.exports = { main }
`,
  plate: `const { roundedCuboid, cuboid } = require('@jscad/modeling').primitives
const { subtract } = require('@jscad/modeling').booleans
const { translate } = require('@jscad/modeling').transforms
const { colorize } = require('@jscad/modeling').colors

const U = 19.05
const SWITCH = 14
const ROWS = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1.5,1,1,1,1,1,1,1,1,1,1,1,1.5],
  [1.75,1,1,1,1,1,1,1,1,1,1,2.25],
  [2.25,1,1,1,1,1,1,1,1,1,2.75],
  [1.25,1.25,1.25,6.25,1.25,1.25,1.25,1.25]
]

const main = () => {
  const width = 15 * U
  const height = 5 * U
  // roundedCuboid의 모서리 반경은 가장 얇은 축(1.5mm)의 절반보다 작아야 합니다.
  let plate = roundedCuboid({ size: [width + 6, height + 6, 1.5], roundRadius: 0.6, segments: 24 })

  ROWS.forEach((row, y) => {
    let cursor = 0
    row.forEach((unit) => {
      const x = -width / 2 + (cursor + unit / 2) * U
      const z = 0
      const cutout = translate([x, height / 2 - (y + 0.5) * U, z], cuboid({ size: [SWITCH, SWITCH, 5] }))
      plate = subtract(plate, cutout)
      cursor += unit
    })
  })

  return colorize([0.22, 0.25, 0.3, 1], plate)
}

module.exports = { main }
`,
}
