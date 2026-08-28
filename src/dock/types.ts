export type ViewKind = 'projects' | 'shapes' | 'console' | 'editor' | 'preview'

/** 'projects' | 'shapes' | 'console' | 'editor:<projectId>' | 'preview:<projectId>' */
export type TabId = string

export interface DockGroup {
  kind: 'group'
  id: string
  tabs: TabId[]
  active: TabId
}

export interface DockSplit {
  kind: 'split'
  id: string
  axis: 'row' | 'column'
  children: DockNode[]
  /** 합이 1인 비율 */
  sizes: number[]
}

export type DockNode = DockGroup | DockSplit

/** 탭을 떨어뜨린 위치. center 는 같은 그룹에 탭으로 붙이고, 나머지는 그 방향으로 쪼갠다 */
export type DockZone = 'center' | 'left' | 'right' | 'top' | 'bottom'
