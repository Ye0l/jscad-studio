// Scene Graph — 앱이 다루는 표준 모델.
// JSCAD geometry 는 이 모델에서 만들어 내는 결과물이고, UI 는 언제나 이 모델만 본다.

export type Vec3 = [number, number, number]

/** 열 우선 4x4 행렬. JSCAD 의 mat4 와 같은 배치라 그대로 넘길 수 있다 */
export type Mat4 = number[]

export type Axis = 'x' | 'y' | 'z'
export const AXES: Axis[] = ['x', 'y', 'z']

export type PrimitiveKind = 'cuboid' | 'roundedCuboid' | 'cylinder' | 'sphere'
export type BooleanOp = 'union' | 'subtract' | 'intersect'
export type NodeType = 'group' | 'primitive' | 'boolean' | 'stack' | 'code'

export interface Transform {
  position: Vec3
  /** 도 단위. 사람이 읽고 쓰는 값이라 라디안 대신 도로 저장한다 */
  rotation: Vec3
  scale: Vec3
}

/** 기준 객체 상자의 어느 쪽에 붙일지 */
export type AnchorSide = 'min' | 'center' | 'max'

export interface AnchorAxis {
  /** 기준 객체에서 잡을 지점 */
  target: AnchorSide
  /** 내 상자에서 그 지점에 맞출 지점 */
  self: AnchorSide
}

export interface Anchor {
  /** 기준 객체 id */
  target: string
  axes: { x: AnchorAxis | null; y: AnchorAxis | null; z: AnchorAxis | null }
  offset: Vec3
}

export interface NodeBase {
  id: string
  name: string
  visible: boolean
  parent: string | null
  children: string[]
  transform: Transform
  /** '#rrggbb' 또는 null (기본 색) */
  color: string | null
  anchor: Anchor | null
}

export interface PrimitiveNode extends NodeBase {
  type: 'primitive'
  primitive: PrimitiveKind
  params: Record<string, number>
}

export interface GroupNode extends NodeBase {
  type: 'group'
}

export interface BooleanNode extends NodeBase {
  type: 'boolean'
  op: BooleanOp
}

export interface StackNode extends NodeBase {
  type: 'stack'
  /** 층 사이 기본 간격 (mm) */
  gap: number
  /** 층별로 다르게 줄 간격. 없으면 gap 을 쓴다 */
  gaps: Record<string, number>
}

/** 직접 쓴 JSCAD 코드를 객체 하나로 감싸는 탈출구 */
export interface CodeNode extends NodeBase {
  type: 'code'
  code: string
}

export type SceneNode = PrimitiveNode | GroupNode | BooleanNode | StackNode | CodeNode

export interface Workplane {
  /** 지금은 XY 평면만. 나중에 면 선택으로 늘릴 자리 */
  plane: 'xy'
  /** 평면을 월드 Z 에서 얼마나 띄웠는지 */
  offset: number
}

export interface Scene {
  version: 1
  nodes: Record<string, SceneNode>
  /** 최상위 객체 순서 */
  rootIds: string[]
  workplane: Workplane
}

export interface Box {
  min: Vec3
  max: Vec3
}

export interface NodeLayout {
  /** 로컬 형상을 월드로 옮기는 행렬 */
  matrix: Mat4
  /** 월드 기준 축 정렬 상자. 형상이 없으면 null */
  bounds: Box | null
}

export type Layout = Record<string, NodeLayout>

export const DEFAULT_WORKPLANE: Workplane = { plane: 'xy', offset: 0 }

export const emptyScene = (): Scene => ({
  version: 1,
  nodes: {},
  rootIds: [],
  workplane: { ...DEFAULT_WORKPLANE },
})

export const isSceneNode = (value: unknown): value is SceneNode => {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  return typeof node.id === 'string' && typeof node.name === 'string' && typeof node.type === 'string'
}
