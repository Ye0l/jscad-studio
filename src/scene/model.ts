// Scene 을 다루는 순수 함수 모음. 모든 편집은 새 Scene 을 만들어 돌려주므로
// React 상태로 그대로 넣을 수 있고, 되돌리기 같은 기능도 나중에 얹기 쉽다.
import { PRIMITIVES, withDefaults } from './primitives'
import type {
  Anchor, BooleanOp, PrimitiveKind, Scene, SceneNode, Transform, Vec3,
} from './types'
import { emptyScene } from './types'

export const CONTAINER_TYPES = new Set(['group', 'boolean', 'stack'])

export const canHoldChildren = (node: SceneNode | undefined) => !!node && CONTAINER_TYPES.has(node.type)

export const defaultTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
})

const makeId = (scene: Scene) => {
  let id = crypto.randomUUID().slice(0, 8)
  while (scene.nodes[id]) id = crypto.randomUUID().slice(0, 8)
  return id
}

/** "상자", "상자 2", "상자 3" … 처럼 겹치지 않는 이름을 만든다 */
export const uniqueName = (scene: Scene, base: string) => {
  const taken = new Set(Object.values(scene.nodes).map((node) => node.name))
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

const baseNode = (scene: Scene, name: string): Omit<SceneNode, 'type'> => ({
  id: makeId(scene),
  name: uniqueName(scene, name),
  visible: true,
  parent: null,
  children: [],
  transform: defaultTransform(),
  color: null,
  anchor: null,
})

export const makePrimitive = (scene: Scene, kind: PrimitiveKind, params?: Record<string, number>): SceneNode => ({
  ...baseNode(scene, PRIMITIVES[kind].label),
  type: 'primitive',
  primitive: kind,
  params: withDefaults(kind, params ?? {}),
})

export const makeGroup = (scene: Scene, name = '그룹'): SceneNode =>
  ({ ...baseNode(scene, name), type: 'group' })

export const makeBoolean = (scene: Scene, op: BooleanOp, name?: string): SceneNode =>
  ({ ...baseNode(scene, name ?? BOOLEAN_LABELS[op]), type: 'boolean', op })

export const makeStack = (scene: Scene, name = '적층'): SceneNode =>
  ({ ...baseNode(scene, name), type: 'stack', gap: 0, gaps: {} })

export const makeCodeNode = (scene: Scene, code: string, name = '코드'): SceneNode =>
  ({ ...baseNode(scene, name), type: 'code', code })

export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: '합치기',
  subtract: '빼기',
  intersect: '교차',
}

export const NODE_TYPE_LABELS: Record<SceneNode['type'], string> = {
  group: '그룹',
  primitive: '도형',
  boolean: '불리언',
  stack: '적층',
  code: '코드',
}

// ---- 조회 ----

export const childIdsOf = (scene: Scene, id: string | null): string[] =>
  (id === null ? scene.rootIds : scene.nodes[id]?.children ?? [])

export const ancestorsOf = (scene: Scene, id: string): string[] => {
  const list: string[] = []
  let current = scene.nodes[id]?.parent ?? null
  while (current && scene.nodes[current]) {
    list.push(current)
    current = scene.nodes[current].parent
  }
  return list
}

export const descendantsOf = (scene: Scene, id: string): string[] => {
  const list: string[] = []
  const walk = (current: string) => {
    for (const child of scene.nodes[current]?.children ?? []) {
      list.push(child)
      walk(child)
    }
  }
  walk(id)
  return list
}

/** 트리 순서대로 (깊이 정보와 함께) 펼친다. 패널이 그대로 그리면 된다 */
export const flattenScene = (scene: Scene): { id: string; depth: number }[] => {
  const rows: { id: string; depth: number }[] = []
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      if (!scene.nodes[id]) continue
      rows.push({ id, depth })
      walk(scene.nodes[id].children, depth + 1)
    }
  }
  walk(scene.rootIds, 0)
  return rows
}

// ---- 편집 ----

const withNode = (scene: Scene, node: SceneNode): Scene =>
  ({ ...scene, nodes: { ...scene.nodes, [node.id]: node } })

export const patchNode = (scene: Scene, id: string, changes: Partial<SceneNode>): Scene => {
  const node = scene.nodes[id]
  if (!node) return scene
  return withNode(scene, { ...node, ...changes } as SceneNode)
}

export const setTransform = (scene: Scene, id: string, changes: Partial<Transform>): Scene => {
  const node = scene.nodes[id]
  if (!node) return scene
  return withNode(scene, { ...node, transform: { ...node.transform, ...changes } })
}

export const setParam = (scene: Scene, id: string, key: string, value: number): Scene => {
  const node = scene.nodes[id]
  if (!node || node.type !== 'primitive') return scene
  return withNode(scene, { ...node, params: withDefaults(node.primitive, { ...node.params, [key]: value }) })
}

export const setAnchor = (scene: Scene, id: string, anchor: Anchor | null): Scene =>
  patchNode(scene, id, { anchor })

export const setGap = (scene: Scene, stackId: string, childId: string, gap: number | null): Scene => {
  const node = scene.nodes[stackId]
  if (!node || node.type !== 'stack') return scene
  const gaps = { ...node.gaps }
  if (gap === null) delete gaps[childId]
  else gaps[childId] = gap
  return withNode(scene, { ...node, gaps })
}

/** parentId 가 null 이면 최상위. index 를 주지 않으면 맨 뒤에 붙인다 */
export const addNode = (scene: Scene, node: SceneNode, parentId: string | null = null, index?: number): Scene => {
  const parent = parentId ? scene.nodes[parentId] : null
  const target = parent && canHoldChildren(parent) ? parent.id : null
  const placed = { ...node, parent: target }
  const nodes = { ...scene.nodes, [placed.id]: placed }
  const siblings = target ? [...nodes[target].children] : [...scene.rootIds]
  siblings.splice(index ?? siblings.length, 0, placed.id)
  if (!target) return { ...scene, nodes, rootIds: siblings }
  return { ...scene, nodes: { ...nodes, [target]: { ...nodes[target], children: siblings } } }
}

const detach = (scene: Scene, id: string): Scene => {
  const node = scene.nodes[id]
  if (!node) return scene
  if (node.parent && scene.nodes[node.parent]) {
    const parent = scene.nodes[node.parent]
    return withNode(scene, { ...parent, children: parent.children.filter((child) => child !== id) })
  }
  return { ...scene, rootIds: scene.rootIds.filter((child) => child !== id) }
}

export const removeNode = (scene: Scene, id: string): Scene => {
  if (!scene.nodes[id]) return scene
  const doomed = new Set([id, ...descendantsOf(scene, id)])
  const detached = detach(scene, id)
  const nodes: Record<string, SceneNode> = {}
  for (const [key, node] of Object.entries(detached.nodes)) {
    if (doomed.has(key)) continue
    // 사라진 객체를 기준으로 삼던 배치는 그 자리에 그대로 남긴다
    const anchor = node.anchor && doomed.has(node.anchor.target) ? null : node.anchor
    const children = node.children.filter((child) => !doomed.has(child))
    const stackGaps = node.type === 'stack'
      ? Object.fromEntries(Object.entries(node.gaps).filter(([child]) => !doomed.has(child)))
      : null
    nodes[key] = { ...node, anchor, children, ...(stackGaps ? { gaps: stackGaps } : {}) } as SceneNode
  }
  return { ...detached, nodes, rootIds: detached.rootIds.filter((child) => !doomed.has(child)) }
}

/** 자기 자신이나 자손 밑으로는 옮길 수 없다 */
export const canMoveInto = (scene: Scene, id: string, parentId: string | null) => {
  if (parentId === null) return true
  if (parentId === id) return false
  if (!canHoldChildren(scene.nodes[parentId])) return false
  return !ancestorsOf(scene, parentId).includes(id) 
}

export const moveNode = (scene: Scene, id: string, parentId: string | null, index: number): Scene => {
  const node = scene.nodes[id]
  if (!node || !canMoveInto(scene, id, parentId)) return scene
  const sameParent = (node.parent ?? null) === parentId
  const before = childIdsOf(scene, parentId).indexOf(id)
  const detached = detach(scene, id)
  const target = parentId && detached.nodes[parentId] ? parentId : null
  const siblings = target ? [...detached.nodes[target].children] : [...detached.rootIds]
  // 같은 부모 안에서 뒤로 옮길 때 자기 자리가 빠진 만큼 보정한다
  const at = Math.max(0, Math.min(siblings.length, sameParent && before >= 0 && before < index ? index - 1 : index))
  siblings.splice(at, 0, id)
  const moved = { ...detached.nodes[id], parent: target }
  const nodes = { ...detached.nodes, [id]: moved }
  if (!target) return { ...detached, nodes, rootIds: siblings }
  return { ...detached, nodes: { ...nodes, [target]: { ...nodes[target], children: siblings } }, rootIds: detached.rootIds }
}

/** 부모 안에서 한 칸 위/아래로 */
export const reorderNode = (scene: Scene, id: string, direction: 1 | -1): Scene => {
  const node = scene.nodes[id]
  if (!node) return scene
  const siblings = childIdsOf(scene, node.parent ?? null)
  const at = siblings.indexOf(id)
  const next = at + direction
  if (at < 0 || next < 0 || next >= siblings.length) return scene
  return moveNode(scene, id, node.parent ?? null, direction > 0 ? next + 1 : next)
}

export const duplicateNode = (scene: Scene, id: string): { scene: Scene; id: string | null } => {
  const source = scene.nodes[id]
  if (!source) return { scene, id: null }
  let next = scene
  const remap = new Map<string, string>()

  const copy = (sourceId: string, parentId: string | null, index?: number): string | null => {
    const original = next.nodes[sourceId]
    if (!original) return null
    const clone = {
      ...structuredClone(original),
      id: makeId(next),
      name: uniqueName(next, `${original.name} 사본`),
      children: [],
    } as SceneNode
    remap.set(sourceId, clone.id)
    next = addNode(next, clone, parentId, index)
    for (const child of original.children) copy(child, clone.id)
    return clone.id
  }

  const siblings = childIdsOf(scene, source.parent ?? null)
  const created = copy(id, source.parent ?? null, siblings.indexOf(id) + 1)
  if (!created) return { scene, id: null }

  // 복제한 묶음 안에서 서로를 기준으로 삼던 배치는 복제본끼리 이어지게 한다
  const fixed = { ...next.nodes }
  for (const newId of remap.values()) {
    const node = fixed[newId]
    if (!node?.anchor) continue
    const mapped = remap.get(node.anchor.target)
    if (mapped) fixed[newId] = { ...node, anchor: { ...node.anchor, target: mapped } }
  }
  return { scene: { ...next, nodes: fixed }, id: created }
}

/** 고른 객체들을 새 불리언 노드로 묶는다. 순서는 트리 순서를 따른다 */
export const groupInto = (
  scene: Scene,
  ids: string[],
  factory: (scene: Scene) => SceneNode,
): { scene: Scene; id: string | null } => {
  const order = flattenScene(scene).map((row) => row.id)
  const targets = ids.filter((id) => scene.nodes[id]).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  if (targets.length < 1) return { scene, id: null }
  // 서로 조상·자손 관계인 것은 위쪽만 남긴다
  const roots = targets.filter((id) => !ancestorsOf(scene, id).some((parent) => targets.includes(parent)))
  const first = scene.nodes[roots[0]]
  const parentId = first.parent ?? null
  const index = childIdsOf(scene, parentId).indexOf(roots[0])

  const container = factory(scene)
  let next = addNode(scene, container, parentId, index)
  roots.forEach((id, at) => { next = moveNode(next, id, container.id, at) })
  return { scene: next, id: container.id }
}

export const cloneScene = (scene: Scene): Scene => structuredClone(scene)

export { emptyScene }

/** 저장본을 읽을 때 모양이 깨진 데이터를 걸러 낸다 */
export const sanitizeScene = (value: unknown): Scene | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<Scene>
  if (!raw.nodes || typeof raw.nodes !== 'object' || !Array.isArray(raw.rootIds)) return null
  const scene = emptyScene()
  const vec = (input: unknown, fallback: Vec3): Vec3 => (Array.isArray(input) && input.length === 3
    && input.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [input[0], input[1], input[2]] as Vec3
    : fallback)

  for (const [id, item] of Object.entries(raw.nodes as Record<string, SceneNode>)) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') continue
    if (!['group', 'primitive', 'boolean', 'stack', 'code'].includes(item.type)) continue
    const transform = item.transform ?? defaultTransform()
    scene.nodes[id] = {
      ...item,
      id,
      name: typeof item.name === 'string' && item.name ? item.name : '객체',
      visible: item.visible !== false,
      parent: typeof item.parent === 'string' ? item.parent : null,
      children: Array.isArray(item.children) ? item.children.filter((child) => typeof child === 'string') : [],
      color: typeof item.color === 'string' ? item.color : null,
      anchor: item.anchor && typeof item.anchor.target === 'string' ? item.anchor : null,
      transform: {
        position: vec(transform.position, [0, 0, 0]),
        rotation: vec(transform.rotation, [0, 0, 0]),
        scale: vec(transform.scale, [1, 1, 1]),
      },
      ...(item.type === 'primitive'
        ? { params: withDefaults(item.primitive, item.params ?? {}) }
        : {}),
    } as SceneNode
  }

  // 없는 자식·부모를 정리해 트리를 다시 세운다
  const ids = new Set(Object.keys(scene.nodes))
  for (const node of Object.values(scene.nodes)) {
    node.children = node.children.filter((child) => ids.has(child) && child !== node.id)
    if (node.parent && !ids.has(node.parent)) node.parent = null
    if (node.anchor && !ids.has(node.anchor.target)) node.anchor = null
  }
  // 최상위부터 훑어 내려가며 실제로 닿는 노드만 자식으로 남긴다 (중복 부모와 순환 방어)
  const seen = new Set<string>()
  const claim = (id: string, parent: string | null): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    scene.nodes[id].parent = parent
    scene.nodes[id].children = scene.nodes[id].children.filter((child) => claim(child, id))
    return true
  }
  scene.rootIds = (raw.rootIds as string[]).filter((id) => ids.has(id) && claim(id, null))
  // 어디에도 닿지 않은 노드는 최상위로 끌어올려 잃어버리지 않는다
  for (const id of ids) {
    if (claim(id, null)) scene.rootIds.push(id)
  }
  const plane = raw.workplane
  scene.workplane = {
    plane: 'xy',
    offset: typeof plane?.offset === 'number' && Number.isFinite(plane.offset) ? plane.offset : 0,
  }
  return scene
}
