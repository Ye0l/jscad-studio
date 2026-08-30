import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Box, ChevronDown, ChevronRight, Circle, Combine, Cylinder, Diff, Eye, EyeOff,
  FileCode, GripVertical, Group, Layers, Plus, Ruler, SquareStack,
} from 'lucide-react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { canHoldChildren, childIdsOf, flattenScene, moveNode } from '../scene/model'
import { round } from '../scene/mat'
import { PRIMITIVES, PRIMITIVE_KINDS } from '../scene/primitives'
import type { BooleanOp, PrimitiveKind, Scene, SceneNode } from '../scene/types'

export type AddKind = PrimitiveKind | 'group' | 'stack' | 'code' | BooleanOp

export type SelectMode = 'single' | 'toggle' | 'range'

interface Props {
  scene: Scene
  selection: string[]
  renamingId: string | null
  onSelect: (id: string, mode: SelectMode) => void
  onScene: (next: Scene) => void
  onMenu: (id: string, point: { x: number; y: number }) => void
  onRename: (id: string, name: string) => void
  onRenameEnd: () => void
  onAdd: (kind: AddKind) => void
}

type DropZone = 'before' | 'after' | 'inside'

interface DragState {
  id: string
  y: number
  target: { id: string | null; zone: DropZone } | null
}

const LONG_PRESS = 420
const DRAG_THRESHOLD = 6

const nodeIcon = (node: SceneNode) => {
  if (node.type === 'group') return <Group size={14} />
  if (node.type === 'stack') return <Layers size={14} />
  if (node.type === 'code') return <FileCode size={14} />
  if (node.type === 'boolean') {
    return node.op === 'subtract' ? <Diff size={14} /> : node.op === 'intersect' ? <Combine size={14} /> : <SquareStack size={14} />
  }
  if (node.primitive === 'sphere') return <Circle size={14} />
  if (node.primitive === 'cylinder') return <Cylinder size={14} />
  return <Box size={14} />
}

const ADD_ITEMS: { kind: AddKind; label: string; icon: ReactNode }[] = [
  ...PRIMITIVE_KINDS.map((kind) => ({ kind, label: PRIMITIVES[kind].label, icon: <Box size={15} /> })),
  { kind: 'group', label: '그룹', icon: <Group size={15} /> },
  { kind: 'stack', label: '적층', icon: <Layers size={15} /> },
  { kind: 'union', label: '합치기 노드', icon: <SquareStack size={15} /> },
  { kind: 'subtract', label: '빼기 노드', icon: <Diff size={15} /> },
  { kind: 'code', label: '코드 객체', icon: <FileCode size={15} /> },
]

export function ObjectTree({
  scene, selection, renamingId, onSelect, onScene, onMenu, onRename, onRenameEnd, onAdd,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<DragState | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)
  const [workplaneText, setWorkplaneText] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const pressRef = useRef<{ id: string; y: number; timer: number; moved: boolean; armed: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const hidden = new Set<string>()
    return flattenScene(scene).filter(({ id }) => {
      const node = scene.nodes[id]
      if (node.parent && (hidden.has(node.parent) || collapsed.has(node.parent))) {
        hidden.add(id)
        return false
      }
      return true
    })
  }, [scene, collapsed])

  const toggleCollapse = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const targetAt = (clientY: number, dragId: string): DragState['target'] => {
    const host = listRef.current
    if (!host) return null
    const rowElements = [...host.querySelectorAll<HTMLElement>('[data-node-id]')]
    for (const element of rowElements) {
      const rect = element.getBoundingClientRect()
      if (clientY < rect.top || clientY > rect.bottom) continue
      const id = element.dataset.nodeId!
      if (id === dragId) return null
      const ratio = (clientY - rect.top) / rect.height
      const container = canHoldChildren(scene.nodes[id])
      if (container && ratio > 0.28 && ratio < 0.72) return { id, zone: 'inside' }
      return { id, zone: ratio < 0.5 ? 'before' : 'after' }
    }
    // 목록 아래 빈 곳에 놓으면 최상위 맨 끝으로
    const last = rowElements[rowElements.length - 1]
    if (last && clientY > last.getBoundingClientRect().bottom) return { id: null, zone: 'after' }
    return null
  }

  const applyDrop = (state: DragState) => {
    const target = state.target
    if (!target) return
    if (target.id === null) {
      onScene(moveNode(scene, state.id, null, scene.rootIds.length))
      return
    }
    const node = scene.nodes[target.id]
    if (!node) return
    if (target.zone === 'inside') {
      onScene(moveNode(scene, state.id, target.id, node.children.length))
      return
    }
    const parentId = node.parent ?? null
    const siblings = childIdsOf(scene, parentId)
    const at = siblings.indexOf(target.id) + (target.zone === 'after' ? 1 : 0)
    onScene(moveNode(scene, state.id, parentId, at))
  }

  const store = (state: DragState | null) => {
    dragRef.current = state
    setDrag(state)
  }

  const endPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }

  const beginDrag = (id: string, y: number) => store({ id, y, target: targetAt(y, id) })

  return (
    <div className="tree-view">
      <div className="tree-toolbar">
        <button
          className="button ghost tiny-button"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setAddAt({ x: rect.left, y: rect.bottom + 4 })
          }}
        >
          <Plus size={15} />객체 추가
        </button>
        <span className="tree-count">{Object.keys(scene.nodes).length}개</span>
      </div>

      <div className="workplane-bar" title="새 객체가 놓이는 높이. 값을 바꿔도 이미 놓인 객체는 움직이지 않습니다">
        <Ruler size={13} />
        <span>작업면 Z</span>
        <input
          type="text"
          inputMode="decimal"
          value={workplaneText ?? String(round(scene.workplane.offset, 3))}
          onChange={(event) => {
            setWorkplaneText(event.target.value)
            const value = Number(event.target.value)
            if (event.target.value.trim() !== '' && Number.isFinite(value)) {
              onScene({ ...scene, workplane: { ...scene.workplane, offset: value } })
            }
          }}
          onBlur={() => setWorkplaneText(null)}
        />
        <span className="workplane-unit">mm</span>
        <button
          className="ins-link"
          disabled={!scene.workplane.offset}
          onClick={() => {
            setWorkplaneText(null)
            onScene({ ...scene, workplane: { ...scene.workplane, offset: 0 } })
          }}
        >
          초기화
        </button>
      </div>

      <div className="tree-list" ref={listRef}>
        {rows.map(({ id, depth }) => {
          const node = scene.nodes[id]
          const selected = selection.includes(id)
          const container = canHoldChildren(node)
          const isDropTarget = drag?.target?.id === id
          return (
            <div
              key={id}
              data-node-id={id}
              className={`tree-row${selected ? ' selected' : ''}${node.visible ? '' : ' hidden-node'}`
                + `${drag?.id === id ? ' is-dragging' : ''}`
                + `${isDropTarget ? ` drop-${drag!.target!.zone}` : ''}`}
              style={{ paddingLeft: `${6 + depth * 13}px` }}
              onPointerDown={(event) => {
                if (event.button === 2) return
                onSelect(id, event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : 'single')
                if (renamingId === id) return
                const armed = event.pointerType === 'mouse'
                pressRef.current = {
                  id,
                  y: event.clientY,
                  moved: false,
                  armed,
                  // 태블릿에서는 길게 눌러 메뉴를 연다 (끌기는 손잡이로)
                  timer: armed ? 0 : window.setTimeout(() => {
                    const point = { x: event.clientX, y: event.clientY }
                    endPress()
                    onMenu(id, point)
                  }, LONG_PRESS),
                }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const press = pressRef.current
                if (press && press.armed && !press.moved) {
                  if (Math.abs(event.clientY - press.y) < DRAG_THRESHOLD) return
                  press.moved = true
                  beginDrag(press.id, event.clientY)
                  return
                }
                if (press && !press.armed && Math.abs(event.clientY - press.y) > DRAG_THRESHOLD) endPress()
                if (dragRef.current) store({ ...dragRef.current, y: event.clientY, target: targetAt(event.clientY, dragRef.current.id) })
              }}
              onPointerUp={() => {
                endPress()
                const state = dragRef.current
                if (state) {
                  applyDrop(state)
                  store(null)
                }
              }}
              onPointerCancel={() => { endPress(); store(null) }}
              onContextMenu={(event) => {
                event.preventDefault()
                onMenu(id, { x: event.clientX, y: event.clientY })
              }}
              onDoubleClick={() => onRename(id, node.name)}
            >
              <button
                className={`tree-twisty${container && node.children.length ? '' : ' is-empty'}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => container && node.children.length && toggleCollapse(id)}
                tabIndex={-1}
                aria-hidden={!container}
              >
                {container && node.children.length
                  ? (collapsed.has(id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />)
                  : null}
              </button>
              <span className="tree-icon">{nodeIcon(node)}</span>
              {renamingId === id ? (
                <input
                  className="tree-rename"
                  autoFocus
                  defaultValue={node.name}
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={(event) => { onRename(id, event.target.value); onRenameEnd() }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { onRename(id, event.currentTarget.value); onRenameEnd() }
                    if (event.key === 'Escape') onRenameEnd()
                  }}
                />
              ) : (
                <span className="tree-name">{node.name}</span>
              )}
              <button
                className="tree-eye"
                aria-label={node.visible ? '숨기기' : '보이기'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onScene({ ...scene, nodes: { ...scene.nodes, [id]: { ...node, visible: !node.visible } } })}
              >
                {node.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <span
                className="tree-grip"
                aria-hidden
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onSelect(id, 'single')
                  beginDrag(id, event.clientY)
                }}
                onPointerMove={(event) => {
                  if (dragRef.current) store({ ...dragRef.current, y: event.clientY, target: targetAt(event.clientY, dragRef.current.id) })
                }}
                onPointerUp={() => {
                  const state = dragRef.current
                  if (!state) return
                  applyDrop(state)
                  store(null)
                }}
                onPointerCancel={() => store(null)}
              >
                <GripVertical size={13} />
              </span>
            </div>
          )
        })}

        {!rows.length && (
          <div className="tree-empty">
            <p>아직 객체가 없습니다.</p>
            <p className="muted-copy">“객체 추가”로 상자나 원기둥을 놓아 보세요. 코드 편집기도 그대로 쓸 수 있습니다.</p>
          </div>
        )}
      </div>

      {drag?.target?.id === null && <div className="tree-root-drop">최상위 맨 끝으로</div>}

      {addAt && (
        <ContextMenu
          point={addAt}
          onClose={() => setAddAt(null)}
          items={ADD_ITEMS.map((item): MenuItem => ({
            id: item.kind,
            label: item.label,
            icon: item.icon,
            onSelect: () => onAdd(item.kind),
          }))}
        />
      )}
    </div>
  )
}
