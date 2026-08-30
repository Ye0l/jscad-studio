import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  children: ReactNode
  footer?: ReactNode
  closing: boolean
  /** 코드처럼 폭이 필요한 내용에 쓴다 */
  wide?: boolean
  onClose: () => void
}

export function Modal({ title, children, footer, closing, wide = false, onClose }: Props) {
  return (
    <div className={`modal-layer${closing ? ' is-closing' : ''}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
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

