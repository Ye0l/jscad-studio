import { useRef, type RefObject } from 'react'
import { Code2, Plus, Search } from 'lucide-react'
import type { ProjectMeta } from '../types'

interface Props {
  projects: ProjectMeta[]
  openIds: string[]
  focusedId: string | null
  query: string
  onQuery: (value: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  onOpen: (id: string) => void
  onMenu: (id: string, point: { x: number; y: number }) => void
  onNew: () => void
}

const LONG_PRESS = 480

const formatTime = (iso: string) => new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

export function ProjectList({ projects, openIds, focusedId, query, onQuery, searchRef, onOpen, onMenu, onNew }: Props) {
  const press = useRef<{ timer: number; point: { x: number; y: number } } | null>(null)

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }

  return (
    <div className="project-view">
      <label className="search-box">
        <Search size={15} />
        <input ref={searchRef} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="프로젝트 검색" />
        <kbd>Ctrl P</kbd>
      </label>
      <nav className="project-list">
        {projects.map((item) => (
          <button
            key={item.id}
            className={`project-item${item.id === focusedId ? ' active' : ''}${openIds.includes(item.id) ? ' is-open' : ''}`}
            onClick={() => onOpen(item.id)}
            onContextMenu={(event) => { event.preventDefault(); onMenu(item.id, { x: event.clientX, y: event.clientY }) }}
            // 태블릿에서는 길게 눌러 같은 메뉴를 연다
            onPointerDown={(event) => {
              if (event.pointerType === 'mouse') return
              const point = { x: event.clientX, y: event.clientY }
              press.current = { point, timer: window.setTimeout(() => { press.current = null; onMenu(item.id, point) }, LONG_PRESS) }
            }}
            onPointerMove={(event) => {
              const started = press.current
              if (!started) return
              if (Math.hypot(event.clientX - started.point.x, event.clientY - started.point.y) > 8) cancelPress()
            }}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
          >
            <span className="project-icon"><Code2 size={17} /></span>
            <span className="project-copy"><strong>{item.name}</strong><small>{formatTime(item.updatedAt)}</small></span>
            {openIds.includes(item.id) && <span className="active-pip" />}
          </button>
        ))}
        {!projects.length && <p className="muted-copy empty-copy">검색과 일치하는 프로젝트가 없습니다.</p>}
      </nav>
      <button className="new-project-button" onClick={onNew}><Plus size={17} />새 프로젝트 <kbd>Ctrl N</kbd></button>
    </div>
  )
}
