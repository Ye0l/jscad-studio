// Scene + 배치 결과 → JSCAD 형상.
// 로컬 형상은 원점에 만들고 배치 행렬을 그대로 적용하므로, 뷰포트와 Inspector 값이 어긋나지 않는다.
import * as modelingModule from '@jscad/modeling'
import { PRIMITIVES } from './primitives'
import type { Box, Layout, Mat4, Scene, SceneNode } from './types'

const jscad = ((modelingModule as unknown as { default?: typeof modelingModule }).default
  ?? modelingModule) as typeof modelingModule

export interface BuildItem {
  /** 이 형상을 만들어 낸 객체 */
  id: string
  geometry: unknown
}

export interface BuildError {
  id: string
  name: string
  message: string
}

export interface BuildResult {
  items: BuildItem[]
  errors: BuildError[]
}

const RGB = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

export const hexToRgb = (hex: string): [number, number, number] | null => {
  const match = RGB.exec(hex.trim())
  if (!match) return null
  return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
}

const primitiveGeometry = (node: SceneNode) => {
  if (node.type !== 'primitive') return null
  const spec = PRIMITIVES[node.primitive]
  const factory = (jscad.primitives as unknown as Record<string, (options: unknown) => unknown>)[spec.fn]
  return factory(spec.args(node.params))
}

type JscadMatrix = Parameters<typeof jscad.transforms.transform>[0]

/** 배치 행렬을 JSCAD 형상에 그대로 적용한다 (열 우선 16개로 배치가 같다) */
const place = (matrix: Mat4, geometry: unknown) =>
  jscad.transforms.transform(matrix as unknown as JscadMatrix, geometry as never) as unknown

const asSingle = (geometries: unknown[]): unknown | null => {
  if (!geometries.length) return null
  if (geometries.length === 1) return geometries[0]
  return jscad.booleans.union(...(geometries as Parameters<typeof jscad.booleans.union>))
}

export interface BuildOptions {
  /** 코드 객체가 만들어 낸 로컬 형상 */
  codeGeometries?: Record<string, unknown[]>
}

export const buildScene = (scene: Scene, layout: Layout, options: BuildOptions = {}): BuildResult => {
  const errors: BuildError[] = []
  const items: BuildItem[] = []

  const paint = (node: SceneNode, geometries: unknown[], inherited: string | null) => {
    const hex = node.color ?? inherited
    const rgb = hex ? hexToRgb(hex) : null
    if (!rgb || !geometries.length) return geometries
    return geometries.map((geometry) => jscad.colors.colorize(rgb, geometry as never))
  }

  const build = (id: string, inherited: string | null): unknown[] => {
    const node = scene.nodes[id]
    if (!node || !node.visible) return []
    const matrix = layout[id]?.matrix
    const color = node.color ?? inherited

    try {
      if (node.type === 'primitive') {
        const local = primitiveGeometry(node)
        return paint(node, matrix ? [place(matrix, local)] : [local], inherited)
      }
      if (node.type === 'code') {
        const parts = options.codeGeometries?.[id] ?? []
        const placed = matrix ? parts.map((part) => place(matrix, part)) : parts
        return paint(node, placed, inherited)
      }

      const childGeometries = node.children.map((child) => build(child, color))
      if (node.type === 'boolean') {
        const operands = childGeometries.map(asSingle).filter(Boolean) as unknown[]
        if (!operands.length) return []
        if (operands.length === 1) return paint(node, operands, inherited)
        const op = node.op === 'subtract' ? jscad.booleans.subtract
          : node.op === 'intersect' ? jscad.booleans.intersect
            : jscad.booleans.union
        return paint(node, [op(...(operands as Parameters<typeof jscad.booleans.union>))], inherited)
      }
      return childGeometries.flat()
    } catch (error) {
      errors.push({ id, name: node.name, message: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  for (const id of scene.rootIds) {
    for (const geometry of build(id, null)) items.push({ id, geometry })
  }
  return { items, errors }
}

/** 코드 객체의 로컬 상자. 배치 계산이 anchor 를 풀 때 쓴다 */
export const measureLocalBounds = (geometries: unknown[]): Box | null => {
  if (!geometries.length) return null
  try {
    const [min, max] = jscad.measurements.measureAggregateBoundingBox(
      ...(geometries as Parameters<typeof jscad.measurements.measureAggregateBoundingBox>),
    ) as [number[], number[]]
    return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
  } catch {
    return null
  }
}
