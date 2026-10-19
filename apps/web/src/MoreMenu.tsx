import { Ellipsis } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** One entry of a `MoreMenu`. */
export interface MoreAction {
  label: string
  icon: ReactNode
  /** Greyed, while there is nothing for it to do. */
  disabled?: boolean
  run: () => void
}

/**
 * A "···" button that opens, under it, what else a panel offers besides its rows: the actions that
 * are not worth a button of their own. A click elsewhere, Escape or leaving the window closes it.
 */
export function MoreMenu({ title, actions }: { title: string; actions: MoreAction[] }) {
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  // Under the button, ending where it ends, kept on screen.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return
    const at = button.current.getBoundingClientRect()
    const box = menu.current.getBoundingClientRect()
    setPosition({ left: Math.max(4, Math.min(at.right - box.width, window.innerWidth - box.width - 4)), top: at.bottom + 4 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return (
    <>
      <button ref={button} className="icon-button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Ellipsis size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="menu-list context-menu more-menu" role="menu" style={position}>
            {actions.map((action) => (
              <button
                key={action.label}
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false)
                  action.run()
                }}
              >
                <span className="menu-icon">{action.icon}</span>
                <span className="menu-title">{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
