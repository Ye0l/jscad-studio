import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Layers, Plus } from 'lucide-react'
import { boxSize, round } from '../scene/mat'
import { ancestorsOf, moveNode, patchNode, reorderNode, setGap, setParam } from '../scene/model'
import type { Layout, Scene, SceneNode, StackNode } from '../scene/types'

interface Props {
  scene: Scene | null
  layout: Layout
  selection: string[]
  onScene: (next: Scene, options?: { coalesce?: string }) => void
  onSelect: (id: string) => void
  onCreate: () => void
}

/** 층 두께: 상자·원기둥이면 높이 값을 바로 고칠 수 있고, 그 밖에는 계산된 값을 보여 준다 */
const thicknessOf = (node: SceneNode, layout: Layout) => {
  if (node.type === 'primitive' && 'height' in node.params) {
    return { value: node.params.height, editable: true }
  }
  return { value: boxSize(layout[node.id]?.bounds ?? null)[2], editable: false }
}

export function StackEditor({ scene, layout, selection, onScene, onSelect, onCreate }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; y: number; over: string | null } | null>(null)
  const dragRef = useRef<typeof drag>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const stacks = scene
    ? Object.values(scene.nodes).filter((node): node is StackNode => node.type === 'stack')
    : []

  // 고른 객체가 속한 적층을 먼저 보여 준다
  const fromSelection = scene && selection.length
    ? [selection[selection.length - 1], ...ancestorsOf(scene, selection[selection.length - 1])]
      .find((id) => scene.nodes[id]?.type === 'stack') ?? null
    : null
  const activeId = (picked && stacks.some((item) => item.id === picked) ? picked : null)
    ?? fromSelection ?? stacks[0]?.id ?? null
  const stack = activeId && scene ? scene.nodes[activeId] as StackNode : null

  if (!scene || !stacks.length || !stack) {
    return (
      <div className="stack-view empty">
        <p className="muted-copy">
          적층은 바닥판·스페이서·보강판처럼 층으로 쌓는 구조를 코드 없이 만드는 기능입니다.
          객체를 고르고 아래 버튼을 누르면 고른 객체들이 하나의 적층으로 묶입니다.
        </p>
        <button className="button ghost" onClick={onCreate}><Layers size={16} />적층 만들기</button>
      </div>
    )
  }

  const total = boxSize(layout[stack.id]?.bounds ?? null)[2]

  const targetAt = (clientY: number, dragId: string) => {
    const host = listRef.current
    if (!host) return null
    for (const element of host.querySelectorAll<HTMLElement>('[data-layer-id]')) {
      const rect = element.getBoundingClientRect()
      if (clientY < rect.top || clientY > rect.bottom) continue
      const id = element.dataset.layerId!
      return id === dragId ? null : id
    }
    return null
  }

  const drop = () => {
    const state = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!state?.over) return
    const at = stack.children.indexOf(state.over)
    const from = stack.children.indexOf(state.id)
    onScene(moveNode(scene, state.id, stack.id, from < at ? at + 1 : at))
  }

  return (
    <div className="stack-view">
      <div className="stack-head">
        {stacks.length > 1 ? (
          <select className="ins-select" value={stack.id} onChange={(event) => setPicked(event.target.value)}>
            {stacks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : (
          <strong>{stack.name}</strong>
        )}
        <button className="icon-button tiny" title="적층 추가" onClick={onCreate}><Plus size={16} /></button>
      </div>

      <div className="stack-list" ref={listRef}>
        {stack.children.map((childId, index) => {
          const child = scene.nodes[childId]
          if (!child) return null
          const thickness = thicknessOf(child, layout)
          const bottom = layout[childId]?.bounds?.min[2]
          const gap = stack.gaps[childId] ?? stack.gap
          return (
            <div
              key={childId}
              data-layer-id={childId}
              className={`stack-row${selection.includes(childId) ? ' selected' : ''}`
                + `${child.visible ? '' : ' hidden-node'}${drag?.over === childId ? ' is-over' : ''}`}
              onPointerDown={() => onSelect(childId)}
            >
              <span
                className="tree-grip"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  dragRef.current = { id: childId, y: event.clientY, over: null }
                  setDrag(dragRef.current)
                }}
                onPointerMove={(event) => {
                  if (!dragRef.current) return
                  dragRef.current = { ...dragRef.current, y: event.clientY, over: targetAt(event.clientY, childId) }
                  setDrag(dragRef.current)
                }}
                onPointerUp={drop}
                onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
              >
                <GripVertical size={13} />
              </span>
              <span className="stack-order">{index + 1}</span>
              <span className="stack-name">{child.name}</span>

              <span className="stack-actions">
                <button
                  className="icon-button tiny"
                  aria-label={child.visible ? '층 끄기' : '층 켜기'}
                  onClick={() => onScene(patchNode(scene, childId, { visible: !child.visible }))}
                >
                  {child.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button className="icon-button tiny" aria-label="위로" disabled={index === 0} onClick={() => onScene(reorderNode(scene, childId, -1))}>
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button tiny"
                  aria-label="아래로"
                  disabled={index === stack.children.length - 1}
                  onClick={() => onScene(reorderNode(scene, childId, 1))}
                >
                  <ArrowDown size={14} />
                </button>
              </span>

              <span className="stack-metrics">
              <label className="stack-number" title="두께 (mm)">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={!thickness.editable}
                  value={round(thickness.value, 3)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value > 0) {
                      onScene(setParam(scene, childId, 'height', value), { coalesce: `stack:${childId}` })
                    }
                  }}
                />
                <small>두께</small>
              </label>

              <label className="stack-number" title="이 층 앞의 간격 (mm)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={round(gap, 3)}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      onScene(setGap(scene, stack.id, childId, value), { coalesce: `gap:${childId}` })
                    }
                  }}
                />
                <small>간격</small>
              </label>

              <span className="stack-z">{bottom === undefined ? '–' : `Z ${round(bottom, 2)}`}</span>
              </span>
            </div>
          )
        })}
        {!stack.children.length && (
          <p className="muted-copy empty-copy">객체 트리에서 도형을 이 적층 위로 끌어다 놓으면 층이 됩니다.</p>
        )}
      </div>

      <footer className="stack-total">
        <span>전체 높이</span>
        <strong>{round(total, 2)} mm</strong>
      </footer>
    </div>
  )
}
