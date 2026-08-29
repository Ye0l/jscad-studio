// 배치 계산. 형상(CSG) 없이 상자만 다루므로 드래그 중에도 매 프레임 돌릴 수 있다.
// 여기서 나온 행렬을 그대로 JSCAD 형상에 적용하기 때문에 Inspector·뷰포트·코드가 항상 같은 값을 본다.
import { PRIMITIVES } from './primitives'
import {
  boxOf, fromRotation, fromScaling, fromTranslation, identity, intersectBoxes, mergeBoxes,
  multiply, transformBox, transformPoint, translateBox, translateMatrix,
} from './mat'
import type { AnchorSide, Box, Layout, Mat4, Scene, SceneNode, Vec3 } from './types'

export interface SolveOptions {
  /** 코드 객체처럼 미리 알 수 없는 형상의 로컬 상자 */
  localBounds?: Record<string, Box | null>
  /** 앞 단계 결과. anchor 가 아직 계산되지 않은 객체를 가리킬 때 참고한다 */
  previous?: Layout | null
}

const sideValue = (box: Box, axis: number, side: AnchorSide) => (
  side === 'min' ? box.min[axis] : side === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2
)

const localBoxOf = (node: SceneNode, options: SolveOptions): Box | null => {
  if (node.type === 'primitive') return PRIMITIVES[node.primitive].box(node.params)
  if (node.type === 'code') return options.localBounds?.[node.id] ?? null
  return null
}

/** 자식 상자를 연산 종류에 맞게 합친다. 빼기는 첫 번째 것보다 커질 수 없다 */
const combineChildBoxes = (node: SceneNode, boxes: (Box | null)[]): Box | null => {
  if (node.type !== 'boolean') return mergeBoxes(boxes)
  if (node.op === 'subtract') return boxes[0] ?? null
  if (node.op === 'intersect') return intersectBoxes(boxes)
  return mergeBoxes(boxes)
}

export const solveLayout = (scene: Scene, options: SolveOptions = {}): Layout => {
  const layout: Layout = {}
  const previous = options.previous ?? null

  const shift = (id: string, delta: Vec3) => {
    const entry = layout[id]
    if (!entry) return
    entry.matrix = translateMatrix(entry.matrix, delta)
    entry.bounds = translateBox(entry.bounds, delta)
    for (const child of scene.nodes[id]?.children ?? []) shift(child, delta)
  }

  /** 적층: 보이는 자식을 순서대로 Z 로 쌓는다 */
  const applyStack = (node: SceneNode, base: Mat4) => {
    if (node.type !== 'stack') return
    let cursor = transformPoint(base, [0, 0, 0])[2]
    for (const childId of node.children) {
      const child = scene.nodes[childId]
      const entry = layout[childId]
      if (!child?.visible || !entry?.bounds) continue
      const gap = node.gaps[childId] ?? node.gap
      const target = cursor + gap
      shift(childId, [0, 0, target - entry.bounds.min[2]])
      cursor = layout[childId].bounds!.max[2]
    }
  }

  const solve = (id: string, parentMatrix: Mat4, parent: SceneNode | null) => {
    const node = scene.nodes[id]
    if (!node) return
    const { position, rotation, scale } = node.transform
    const base = multiply(parentMatrix, multiply(fromRotation(rotation), fromScaling(scale)))

    for (const child of node.children) solve(child, base, node)
    applyStack(node, base)

    const childBoxes = node.children
      .filter((child) => scene.nodes[child]?.visible)
      .map((child) => layout[child]?.bounds ?? null)
    const own = node.children.length
      ? combineChildBoxes(node, childBoxes)
      : transformBox(base, localBoxOf(node, options))

    // 자유로운 축은 부모 좌표계에서의 평행이동, anchor 가 걸린 축은 기준 객체에 맞춘다
    const origin = transformPoint(parentMatrix, [0, 0, 0])
    const moved = transformPoint(parentMatrix, position)
    const delta: Vec3 = [moved[0] - origin[0], moved[1] - origin[1], moved[2] - origin[2]]
    const anchor = node.anchor
    const targetBounds = anchor ? layout[anchor.target]?.bounds ?? previous?.[anchor.target]?.bounds ?? null : null
    if (anchor && targetBounds) {
      const selfBox = own ?? boxOf([transformPoint(base, [0, 0, 0])])!
      for (let axis = 0; axis < 3; axis += 1) {
        const rule = anchor.axes[(['x', 'y', 'z'] as const)[axis]]
        if (!rule) continue
        delta[axis] = sideValue(targetBounds, axis, rule.target) + anchor.offset[axis]
          - sideValue(selfBox, axis, rule.self)
      }
    }
    // 적층 안의 자식은 부모가 Z 를 다시 정하므로 여기서는 X·Y 만 의미가 있다
    if (parent?.type === 'stack') delta[2] = 0

    layout[id] = { matrix: translateMatrix(base, delta), bounds: translateBox(own, delta) }
    for (const child of node.children) shift(child, delta)
  }

  for (const id of scene.rootIds) solve(id, identity(), null)
  return layout
}

const hasAnchors = (scene: Scene) => Object.values(scene.nodes).some((node) => node.anchor)

/**
 * anchor 는 다른 객체의 최종 위치를 참고하므로, 사슬처럼 이어지면 한 번에 풀리지 않는다.
 * 상자 계산만 하는 덕에 몇 번 더 돌려도 부담이 없다.
 */
export const solveScene = (scene: Scene, localBounds?: Record<string, Box | null>): Layout => {
  let layout = solveLayout(scene, { localBounds })
  if (!hasAnchors(scene)) return layout
  for (let pass = 0; pass < 3; pass += 1) {
    layout = solveLayout(scene, { localBounds, previous: layout })
  }
  return layout
}

export const worldMatrixOf = (layout: Layout, id: string): Mat4 => layout[id]?.matrix ?? identity()

/** 부모 좌표계 기준 위치를 월드 위치로 (기즈모가 쓰는 값) */
export const localToWorld = (scene: Scene, layout: Layout, id: string, local: Vec3): Vec3 => {
  const node = scene.nodes[id]
  const parent = node?.parent ? layout[node.parent]?.matrix : null
  return transformPoint(parent ?? identity(), local)
}

/** 월드에서 옮긴 만큼을 부모 좌표계의 position 변화량으로 되돌린다 */
export const worldDeltaToLocal = (scene: Scene, layout: Layout, id: string, delta: Vec3): Vec3 => {
  const node = scene.nodes[id]
  const parentMatrix = node?.parent ? layout[node.parent]?.matrix : null
  if (!parentMatrix) return delta
  // 부모의 회전·확대만 되돌리면 된다 (평행이동은 차이에서 이미 사라졌다)
  const inverse = invertRotationScale(parentMatrix)
  return [
    inverse[0] * delta[0] + inverse[1] * delta[1] + inverse[2] * delta[2],
    inverse[3] * delta[0] + inverse[4] * delta[1] + inverse[5] * delta[2],
    inverse[6] * delta[0] + inverse[7] * delta[1] + inverse[8] * delta[2],
  ]
}

/** 3x3 부분의 역행렬을 행 우선 9개 값으로 */
const invertRotationScale = (matrix: Mat4): number[] => {
  const [a, b, c] = [matrix[0], matrix[1], matrix[2]]
  const [d, e, f] = [matrix[4], matrix[5], matrix[6]]
  const [g, h, i] = [matrix[8], matrix[9], matrix[10]]
  const determinant = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (!determinant) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inv = 1 / determinant
  return [
    (e * i - f * h) * inv, (g * f - d * i) * inv, (d * h - g * e) * inv,
    (h * c - b * i) * inv, (a * i - g * c) * inv, (g * b - a * h) * inv,
    (b * f - e * c) * inv, (d * c - a * f) * inv, (a * e - d * b) * inv,
  ]
}

/** 광선과 축 정렬 상자가 만나는 가장 가까운 거리. 스치지 않으면 null (slab 판정) */
export const rayHitsBox = (origin: Vec3, direction: Vec3, box: Box): number | null => {
  let near = -Infinity
  let far = Infinity
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return null
      continue
    }
    const inverse = 1 / direction[axis]
    const first = (box.min[axis] - origin[axis]) * inverse
    const second = (box.max[axis] - origin[axis]) * inverse
    near = Math.max(near, Math.min(first, second))
    far = Math.min(far, Math.max(first, second))
    if (near > far) return null
  }
  return far < 0 ? null : Math.max(near, 0)
}

export { fromTranslation, fromRotation, fromScaling }
