import * as modeling from '@jscad/modeling'

type Maybe<T> = T & { default?: T }
const jscad = ((modeling as Maybe<typeof modeling>).default ?? modeling)
type Solid = Parameters<typeof jscad.measurements.measureAggregateVolume>[0]

export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
}

export const boundsOf = (geometries: unknown[]): Bounds | null => {
  if (!geometries.length) return null
  try {
    const [min, max] = jscad.measurements.measureAggregateBoundingBox(...(geometries as Solid[])) as [number[], number[]]
    const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    if (!size.every((value) => Number.isFinite(value))) return null
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]], size }
  } catch {
    return null
  }
}

/** 치수 숫자를 붙일 세 모서리의 가운데 점 */
export const dimensionAnchors = ({ min, max, size }: Bounds) => [
  { axis: 'x' as const, point: [(min[0] + max[0]) / 2, min[1], min[2]], value: size[0] },
  { axis: 'y' as const, point: [max[0], (min[1] + max[1]) / 2, min[2]], value: size[1] },
  { axis: 'z' as const, point: [max[0], min[1], (min[2] + max[2]) / 2], value: size[2] },
]
