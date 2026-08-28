import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

interface Props {
  point: { x: number; y: number }
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ point, items, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(point)

  // 화면 밖으로 나가지 않도록 그린 뒤 한 번 되민다
  useEffect(() => {
    const box = hostRef.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.min(point.x, window.innerWidth - box.width - 8)
    const y = Math.min(point.y, window.innerHeight - box.height - 8)
    if (x !== place.x || y !== place.y) setPlace({ x: Math.max(8, x), y: Math.max(8, y) })
    // 위치는 열릴 때 한 번만 잡는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.x, point.y])

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (!hostRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div className="context-menu" ref={hostRef} style={{ left: `${place.x}px`, top: `${place.y}px` }} role="menu">
      {items.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          onClick={() => { item.onSelect(); onClose() }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
