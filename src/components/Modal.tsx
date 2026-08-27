import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  children: ReactNode
  footer?: ReactNode
  closing: boolean
  onClose: () => void
}

export function Modal({ title, children, footer, closing, onClose }: Props) {
  return (
    <div className={`modal-layer${closing ? ' is-closing' : ''}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기"><X size={19} /></button>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  )
}

