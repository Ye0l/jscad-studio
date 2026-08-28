import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PALETTE_GROUPS, type PaletteItem } from '../jscadApi'

export interface DropPoint { x: number; y: number }

interface Props {
  /** 탭하거나 편집기 밖에 놓았을 때: 커서 자리에 넣는다 */
  onInsert: (item: PaletteItem) => void
  /** 편집기 위에 놓았을 때: 그 자리에 넣는다 */
  onDrop: (item: PaletteItem, point: DropPoint) => void
  /** 끄는 동안 편집기 위인지 알려 주고, 미리보기 캐럿을 옮긴다 */
  onDragOver: (point: DropPoint | null) => boolean
}

const DRAG_THRESHOLD = 6

export function SnippetPalette({ onInsert, onDrop, onDragOver }: Props) {
  const [openGroup, setOpenGroup] = useState(PALETTE_GROUPS[0].id)
  const [dragging, setDragging] = useState<{ item: PaletteItem; point: DropPoint; over: boolean } | null>(null)
  const start = useRef<{ item: PaletteItem; point: DropPoint; moved: boolean } | null>(null)

  const finish = (point: DropPoint | null) => {
    const pending = start.current
    start.current = null
    setDragging(null)
    onDragOver(null)
    if (!pending) return
    if (!pending.moved || !point) {
      onInsert(pending.item)
      return
    }
    if (onDragOver(point)) onDrop(pending.item, point)
    else onInsert(pending.item)
  }

  return (
    <div className="palette">
      {PALETTE_GROUPS.map((group) => {
        const open = group.id === openGroup
        return (
          <section key={group.id} className={`palette-group${open ? ' open' : ''}`}>
            <button className="palette-group-head" onClick={() => setOpenGroup(open ? '' : group.id)} aria-expanded={open}>
              <span>{group.label}</span>
              <small>{group.items.length}</small>
            </button>
            {open && (
              <div className="palette-items">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`palette-item${dragging?.item.id === item.id ? ' is-dragging' : ''}`}
                    title={item.summary}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      start.current = { item, point: { x: event.clientX, y: event.clientY }, moved: false }
                    }}
                    onPointerMove={(event) => {
                      const pending = start.current
                      if (!pending) return
                      const point = { x: event.clientX, y: event.clientY }
                      if (!pending.moved) {
                        const far = Math.hypot(point.x - pending.point.x, point.y - pending.point.y)
                        if (far < DRAG_THRESHOLD) return
                        pending.moved = true
                      }
                      setDragging({ item, point, over: onDragOver(point) })
                    }}
                    onPointerUp={(event) => finish({ x: event.clientX, y: event.clientY })}
                    onPointerCancel={() => finish(null)}
                  >
                    <strong>{item.label}</strong>
                    <code>{item.signature}</code>
                    <small>{item.summary}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}

      {/* UI 배율 때문에 셸에 걸린 transform 밖으로 빼야 좌표가 맞는다 */}
      {dragging && createPortal(
        <div
          className={`palette-ghost${dragging.over ? ' is-over' : ''}`}
          style={{ left: `${dragging.point.x}px`, top: `${dragging.point.y}px` }}
        >
          {dragging.item.label}
        </div>,
        document.body,
      )}
    </div>
  )
}
