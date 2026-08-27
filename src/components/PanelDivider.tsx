import { useRef } from 'react'

export type ResizeAxis = 'x' | 'y'
export interface ResizePoint { x: number; y: number }

interface Props {
  className: string
  label: string
  // rect 은 손잡이 자신의 크기다. 가로/세로 배치가 화면 폭에 따라 바뀌므로 방향을 여기서 읽는다.
  onResize: (point: ResizePoint, rect: DOMRect) => void
  onNudge: (direction: 1 | -1) => void
  onReset: () => void
  onActive: (axis: ResizeAxis | null) => void
}

export function PanelDivider({ className, label, onResize, onNudge, onReset, onActive }: Props) {
  const dragging = useRef(false)

  const stop = (element: HTMLElement, pointerId: number) => {
    if (!dragging.current) return
    dragging.current = false
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    onActive(null)
  }

  return (
    <div
      className={`panel-divider ${className}`}
      role="separator"
      aria-label={label}
      title={`${label} · 두 번 누르면 기본값`}
      tabIndex={0}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        onActive(rect.width > rect.height ? 'y' : 'x')
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return
        onResize({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect())
      }}
      onPointerUp={(event) => stop(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => stop(event.currentTarget, event.pointerId)}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        if (!back && !forward) return
        event.preventDefault()
        onNudge(back ? -1 : 1)
      }}
    />
  )
}
