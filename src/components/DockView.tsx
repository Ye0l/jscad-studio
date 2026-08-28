import { Fragment, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { PanelDivider, type ResizePoint } from './PanelDivider'
import { activateTab, moveTab, removeTab, setSizes } from '../dock/layout'
import type { DockGroup, DockNode, DockSplit, DockZone, TabId } from '../dock/types'

export interface TabInfo {
  label: string
  icon?: ReactNode
  closable?: boolean
  dirty?: boolean
}

interface Props {
  root: DockNode
  describeTab: (tab: TabId) => TabInfo
  renderView: (tab: TabId) => ReactNode
  renderActions?: (tab: TabId) => ReactNode
  /** persist 가 true 면 설정에 저장한다 (드래그 도중에는 false). 마지막 탭까지 닫으면 null */
  onChange: (next: DockNode | null, persist?: boolean) => void
  onFocus?: (tab: TabId) => void
}

interface DragState {
  tab: TabId
  point: ResizePoint
  target: { groupId: string; zone: DockZone; rect: DOMRect } | null
}

interface Context extends Props {
  drag: DragState | null
  beginDrag: (tab: TabId, point: ResizePoint) => void
  updateDrag: (point: ResizePoint) => void
  endDrag: () => void
}

const MIN_PANE = 130
const EDGE = 0.26
const DRAG_THRESHOLD = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 포인터가 그룹의 어느 쪽에 있는지 — 가장 가까운 가장자리, 가운데면 탭으로 합치기 */
const zoneAt = (rect: DOMRect, point: ResizePoint, overTabs: boolean): DockZone => {
  if (overTabs) return 'center'
  const left = (point.x - rect.left) / rect.width
  const top = (point.y - rect.top) / rect.height
  const distances = { left, right: 1 - left, top, bottom: 1 - top }
  const nearest = (Object.keys(distances) as (keyof typeof distances)[])
    .reduce((best, key) => (distances[key] < distances[best] ? key : best))
  return distances[nearest] > EDGE ? 'center' : nearest
}

const targetAt = (point: ResizePoint): DragState['target'] => {
  const stack = document.elementsFromPoint(point.x, point.y)
  const host = stack.find((element) => element instanceof HTMLElement && element.dataset.dockGroup) as HTMLElement | undefined
  if (!host) return null
  const overTabs = stack.some((element) => element instanceof HTMLElement && element.dataset.dockTabs !== undefined)
  const rect = host.getBoundingClientRect()
  return { groupId: host.dataset.dockGroup!, zone: zoneAt(rect, point, overTabs), rect }
}

// 놓았을 때 실제로 차지하게 될 자리를 그대로 그린다
const zoneBox = (rect: DOMRect, zone: DockZone) => {
  const half = { width: rect.width / 2, height: rect.height / 2 }
  if (zone === 'left') return { left: rect.left, top: rect.top, width: half.width, height: rect.height }
  if (zone === 'right') return { left: rect.left + half.width, top: rect.top, width: half.width, height: rect.height }
  if (zone === 'top') return { left: rect.left, top: rect.top, width: rect.width, height: half.height }
  if (zone === 'bottom') return { left: rect.left, top: rect.top + half.height, width: rect.width, height: half.height }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function GroupView({ node, ctx }: { node: DockGroup; ctx: Context }) {
  const pending = useRef<{ tab: TabId; point: ResizePoint; moved: boolean } | null>(null)

  const closeTab = (tab: TabId) => ctx.onChange(removeTab(ctx.root, tab), true)

  return (
    <section className="dock-group" data-dock-group={node.id}>
      <div className="dock-tabs" data-dock-tabs>
        {node.tabs.map((tab) => {
          const info = ctx.describeTab(tab)
          const selected = tab === node.active
          return (
            <div
              key={tab}
              className={`dock-tab${selected ? ' selected' : ''}${ctx.drag?.tab === tab ? ' is-dragging' : ''}`}
              role="tab"
              aria-selected={selected}
              title={info.label}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.currentTarget.setPointerCapture(event.pointerId)
                pending.current = { tab, point: { x: event.clientX, y: event.clientY }, moved: false }
              }}
              onPointerMove={(event) => {
                const start = pending.current
                if (!start) return
                const point = { x: event.clientX, y: event.clientY }
                if (!start.moved) {
                  if (Math.hypot(point.x - start.point.x, point.y - start.point.y) < DRAG_THRESHOLD) return
                  start.moved = true
                  ctx.beginDrag(tab, point)
                  return
                }
                ctx.updateDrag(point)
              }}
              onPointerUp={() => {
                const start = pending.current
                pending.current = null
                if (!start) return
                if (start.moved) ctx.endDrag()
                else {
                  ctx.onChange(activateTab(ctx.root, tab), true)
                  ctx.onFocus?.(tab)
                }
              }}
              onPointerCancel={() => { pending.current = null; ctx.endDrag() }}
            >
              {info.icon}
              <span>{info.label}</span>
              {info.dirty && <i className="dirty-dot" />}
              {info.closable !== false && (
                <button
                  className="dock-tab-close"
                  aria-label={`${info.label} 닫기`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); closeTab(tab) }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
        <span className="dock-tabs-rest" />
        {ctx.renderActions?.(node.active)}
      </div>
      <div className="dock-body">
        {node.tabs.map((tab) => (
          <div key={tab} className={`dock-view${tab === node.active ? '' : ' is-hidden'}`}>
            {ctx.renderView(tab)}
          </div>
        ))}
      </div>
    </section>
  )
}

function SplitView({ node, ctx }: { node: DockSplit; ctx: Context }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const vertical = node.axis === 'column'

  // 손잡이는 맞닿은 두 칸의 비율만 주고받는다
  const resize = (index: number) => (point: ResizePoint, handle: DOMRect) => {
    const box = hostRef.current?.getBoundingClientRect()
    if (!box) return
    const total = vertical ? box.height : box.width
    if (total <= 0) return
    const offset = (vertical ? point.y - box.top : point.x - box.left) - (vertical ? handle.height : handle.width) / 2
    const before = node.sizes.slice(0, index).reduce((sum, size) => sum + size, 0)
    const pair = node.sizes[index] + node.sizes[index + 1]
    const limit = MIN_PANE / total
    if (pair <= limit * 2) return
    const first = clamp(offset / total - before, limit, pair - limit)
    const sizes = [...node.sizes]
    sizes[index] = first
    sizes[index + 1] = pair - first
    ctx.onChange(setSizes(ctx.root, node.id, sizes))
  }

  const nudge = (index: number) => (direction: 1 | -1) => {
    const box = hostRef.current?.getBoundingClientRect()
    const total = box ? (vertical ? box.height : box.width) : 0
    if (!total) return
    const step = (16 / total) * direction
    const pair = node.sizes[index] + node.sizes[index + 1]
    const limit = MIN_PANE / total
    const first = clamp(node.sizes[index] + step, limit, pair - limit)
    const sizes = [...node.sizes]
    sizes[index] = first
    sizes[index + 1] = pair - first
    ctx.onChange(setSizes(ctx.root, node.id, sizes), true)
  }

  const reset = () => ctx.onChange(setSizes(ctx.root, node.id, node.children.map(() => 1)), true)

  return (
    <div className={`dock-split ${node.axis}`} ref={hostRef}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && (
            <PanelDivider
              className={vertical ? 'panel-divider--y' : 'panel-divider--x'}
              label="패널 크기 조절"
              onResize={resize(index - 1)}
              onNudge={nudge(index - 1)}
              onReset={reset}
              onActive={(axis) => ctx.onChange(ctx.root, !axis)}
            />
          )}
          <div className="dock-pane" style={{ flexGrow: node.sizes[index] }}>
            <DockNodeView node={child} ctx={ctx} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function DockNodeView({ node, ctx }: { node: DockNode; ctx: Context }) {
  return node.kind === 'group' ? <GroupView node={node} ctx={ctx} /> : <SplitView node={node} ctx={ctx} />
}

export function DockView(props: Props) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const store = (state: DragState | null) => {
    dragRef.current = state
    setDrag(state)
  }

  const ctx: Context = {
    ...props,
    drag,
    beginDrag: (tab, point) => store({ tab, point, target: targetAt(point) }),
    updateDrag: (point) => {
      if (!dragRef.current) return
      store({ ...dragRef.current, point, target: targetAt(point) })
    },
    endDrag: () => {
      const state = dragRef.current
      store(null)
      if (!state?.target) return
      props.onChange(moveTab(props.root, state.tab, state.target.groupId, state.target.zone), true)
    },
  }

  const box = drag?.target ? zoneBox(drag.target.rect, drag.target.zone) : null

  return (
    <div className={`dock${drag ? ' is-dragging' : ''}`}>
      <DockNodeView node={props.root} ctx={ctx} />
      {/* UI 배율 transform 밖에서 그려야 화면 좌표가 맞는다 */}
      {drag && createPortal(
        <>
          {box && (
            <div
              className={`dock-drop${drag.target?.zone === 'center' ? ' is-center' : ''}`}
              style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}
            />
          )}
          <div className="dock-ghost" style={{ left: `${drag.point.x}px`, top: `${drag.point.y}px` }}>
            {props.describeTab(drag.tab).label}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
