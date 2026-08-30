import type { DockGroup, DockNode, DockSplit, DockZone, TabId, ViewKind } from './types'

let counter = 0
const nextId = (prefix: string) => `${prefix}${(counter += 1)}`

export const makeTab = (kind: ViewKind, projectId?: string): TabId =>
  (projectId ? `${kind}:${projectId}` : kind)

export const readTab = (tab: TabId): { kind: ViewKind; projectId?: string } => {
  const [kind, projectId] = tab.split(':') as [ViewKind, string | undefined]
  return { kind, projectId }
}

export const group = (tabs: TabId[], active = tabs[0]): DockGroup =>
  ({ kind: 'group', id: nextId('g'), tabs, active })

export const split = (axis: DockSplit['axis'], children: DockNode[], sizes?: number[]): DockSplit =>
  ({ kind: 'split', id: nextId('s'), axis, children, sizes: sizes ?? children.map(() => 1 / children.length) })

export const eachGroup = (node: DockNode, visit: (group: DockGroup) => void): void => {
  if (node.kind === 'group') visit(node)
  else node.children.forEach((child) => eachGroup(child, visit))
}

export const allTabs = (node: DockNode): TabId[] => {
  const tabs: TabId[] = []
  eachGroup(node, (item) => tabs.push(...item.tabs))
  return tabs
}

export const hasTab = (node: DockNode, tab: TabId) => allTabs(node).includes(tab)

export const findGroupOf = (node: DockNode, tab: TabId): DockGroup | null => {
  let found: DockGroup | null = null
  eachGroup(node, (item) => { if (!found && item.tabs.includes(tab)) found = item })
  return found
}

const normalizeSizes = (sizes: number[]) => {
  const total = sizes.reduce((sum, size) => sum + size, 0)
  return total > 0 ? sizes.map((size) => size / total) : sizes.map(() => 1 / sizes.length)
}

/**
 * 빈 그룹과 자식이 하나뿐인 분할을 걷어내고, 같은 방향으로 중첩된 분할을 펼친다.
 * 모든 편집 연산은 이 함수를 마지막에 통과시켜 트리를 단순하게 유지한다.
 */
export const normalize = (node: DockNode | null): DockNode | null => {
  if (!node) return null
  if (node.kind === 'group') {
    if (!node.tabs.length) return null
    return node.tabs.includes(node.active) ? node : { ...node, active: node.tabs[0] }
  }

  const children: DockNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const cleaned = normalize(child)
    if (!cleaned) return
    const share = node.sizes[index] ?? 1 / node.children.length
    // 같은 방향의 분할은 부모 비율을 나눠 가지며 펼친다
    if (cleaned.kind === 'split' && cleaned.axis === node.axis) {
      cleaned.children.forEach((inner, innerIndex) => {
        children.push(inner)
        sizes.push(share * (cleaned.sizes[innerIndex] ?? 1 / cleaned.children.length))
      })
      return
    }
    children.push(cleaned)
    sizes.push(share)
  })

  if (!children.length) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(sizes) }
}

export const removeTab = (node: DockNode, tab: TabId): DockNode | null => {
  if (node.kind === 'group') {
    if (!node.tabs.includes(tab)) return node
    const tabs = node.tabs.filter((item) => item !== tab)
    if (!tabs.length) return null
    const active = node.active === tab
      ? tabs[Math.min(node.tabs.indexOf(tab), tabs.length - 1)]
      : node.active
    return { ...node, tabs, active }
  }
  const children: DockNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const kept = removeTab(child, tab)
    if (!kept) return
    children.push(kept)
    sizes.push(node.sizes[index] ?? 1 / node.children.length)
  })
  return normalize({ ...node, children, sizes: normalizeSizes(sizes) })
}

const NEW_SHARE = 0.34

const insertBeside = (target: DockNode, tab: TabId, zone: Exclude<DockZone, 'center'>): DockSplit => {
  const axis = zone === 'left' || zone === 'right' ? 'row' : 'column'
  const before = zone === 'left' || zone === 'top'
  const fresh = group([tab])
  return before
    ? split(axis, [fresh, target], [NEW_SHARE, 1 - NEW_SHARE])
    : split(axis, [target, fresh], [1 - NEW_SHARE, NEW_SHARE])
}

/** targetGroupId 를 기준으로 탭을 붙이거나 그 방향으로 새 그룹을 만든다 */
export const insertTab = (node: DockNode, tab: TabId, targetGroupId: string, zone: DockZone): DockNode => {
  if (node.kind === 'group') {
    if (node.id !== targetGroupId) return node
    if (zone === 'center') {
      return node.tabs.includes(tab)
        ? { ...node, active: tab }
        : { ...node, tabs: [...node.tabs, tab], active: tab }
    }
    return insertBeside(node, tab, zone)
  }
  return { ...node, children: node.children.map((child) => insertTab(child, tab, targetGroupId, zone)) }
}

export const moveTab = (root: DockNode, tab: TabId, targetGroupId: string, zone: DockZone): DockNode => {
  const source = findGroupOf(root, tab)
  if (!source) return root
  // 혼자 있는 그룹을 자기 자신 위에 놓는 것은 의미가 없다
  if (source.id === targetGroupId && (zone === 'center' || source.tabs.length === 1)) {
    return normalize(insertTab(root, tab, targetGroupId, 'center')) ?? root
  }
  const without = removeTab(root, tab)
  if (!without) return root
  // 원래 그룹이 통째로 사라졌다면 붙일 곳이 없어진 것이므로 되돌린다
  let targetExists = false
  eachGroup(without, (item) => { if (item.id === targetGroupId) targetExists = true })
  if (!targetExists) return root
  return normalize(insertTab(without, tab, targetGroupId, zone)) ?? root
}

/** 이미 열려 있으면 그 자리에서 활성화하고, 없으면 적당한 그룹에 새로 연다 */
export const openTab = (root: DockNode | null, tab: TabId, prefer?: ViewKind): DockNode => {
  if (!root) return group([tab])
  const existing = findGroupOf(root, tab)
  if (existing) return normalize(activateTab(root, tab)) ?? root

  // 같은 종류의 탭이 있는 그룹에 합류하는 것이 가장 자연스럽다
  const wanted = prefer ?? readTab(tab).kind
  const groups: DockGroup[] = []
  eachGroup(root, (item) => groups.push(item))
  const host = groups.find((item) => item.tabs.some((candidate) => readTab(candidate).kind === wanted)) ?? groups[0]
  if (!host) return group([tab])
  return normalize(insertTab(root, tab, host.id, 'center')) ?? root
}

/** 콘솔처럼 전체 폭을 차지해야 하는 뷰는 트리 바깥쪽에 붙인다 */
export const openTabAtRoot = (root: DockNode | null, tab: TabId, zone: Exclude<DockZone, 'center'>): DockNode => {
  if (!root) return group([tab])
  if (hasTab(root, tab)) return normalize(activateTab(root, tab)) ?? root
  return normalize(insertBeside(root, tab, zone)) ?? root
}

export const activateTab = (node: DockNode, tab: TabId): DockNode => {
  if (node.kind === 'group') {
    return node.tabs.includes(tab) ? { ...node, active: tab } : node
  }
  return { ...node, children: node.children.map((child) => activateTab(child, tab)) }
}

export const setSizes = (node: DockNode, splitId: string, sizes: number[]): DockNode => {
  if (node.kind === 'group') return node
  if (node.id === splitId) return { ...node, sizes: normalizeSizes(sizes) }
  return { ...node, children: node.children.map((child) => setSizes(child, splitId, sizes)) }
}

/** 삭제된 프로젝트의 탭을 걷어낸다 */
export const pruneTabs = (root: DockNode | null, keep: (tab: TabId) => boolean): DockNode | null => {
  if (!root) return null
  let result: DockNode | null = root
  for (const tab of allTabs(root)) {
    if (keep(tab) || !result) continue
    result = removeTab(result, tab)
  }
  return normalize(result)
}

/**
 * 기본 배치. 화면이 좁은 태블릿 세로 모드에서는 네 칸이 다 들어가지 않으므로
 * 패널을 탭으로 묶어 두 칸만 쓴다.
 */
export const defaultLayout = (projectId: string): DockNode => {
  const wide = typeof window === 'undefined' ? true : window.innerWidth >= 1100
  if (!wide) {
    return split('row', [
      group(['objects', 'inspector', 'stack', 'projects', 'shapes'], 'objects'),
      group([makeTab('preview', projectId), makeTab('editor', projectId)], makeTab('preview', projectId)),
    ], [0.4, 0.6])
  }
  return split('row', [
    group(['objects', 'projects', 'shapes'], 'objects'),
    group([makeTab('preview', projectId)]),
    group([makeTab('editor', projectId)]),
    group(['inspector', 'stack'], 'inspector'),
  ], [0.19, 0.34, 0.28, 0.19])
}

/** 저장된 레이아웃이 우리가 아는 모양인지 확인한다 (오래된 저장본·손상된 값 방어) */
export const isDockNode = (value: unknown): value is DockNode => {
  if (!value || typeof value !== 'object') return false
  const node = value as Record<string, unknown>
  if (node.kind === 'group') {
    return typeof node.id === 'string' && typeof node.active === 'string'
      && Array.isArray(node.tabs) && node.tabs.every((tab) => typeof tab === 'string')
  }
  if (node.kind === 'split') {
    return typeof node.id === 'string' && (node.axis === 'row' || node.axis === 'column')
      && Array.isArray(node.children) && node.children.length > 0 && node.children.every(isDockNode)
      && Array.isArray(node.sizes) && node.sizes.length === node.children.length
  }
  return false
}

/** 불러온 트리의 id 가 앞으로 만들 id 와 겹치지 않도록 카운터를 밀어 둔다 */
export const reserveIds = (node: DockNode) => {
  const value = Number(node.id.slice(1))
  if (Number.isFinite(value) && value > counter) counter = value
  if (node.kind === 'split') node.children.forEach(reserveIds)
}
