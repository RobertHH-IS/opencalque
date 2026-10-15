import { Ellipsis } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IDockviewHeaderActionsProps } from 'dockview-react'
import { tabsInView } from './dock'
import { t } from './i18n'

/**
 * How much room the "···" button needs at the end of the row: itself and its margin, as `.tab-more`
 * in styles.css draws it, and a little space before it.
 */
const MORE_WIDTH = 34

/** Whether a change in a row of tabs is only the library adding or taking away its drop marks. */
const dropMark = (node: Node) => node instanceof Element && node.closest('.dv-drop-target-dropzone') !== null

/**
 * At the right end of the tabs of a group of panels. When the row is too narrow for all of them,
 * the tabs that do not fit are left out whole (`tab-hidden`), never cut nor scrolled, and this
 * button lists them; one chosen there comes in front, which brings it into the row. The button
 * lies over the end of the empty part of the row, which takes the tabs dropped after the last one:
 * while a panel is dragged (`dock-dragging`, in Layout.tsx), styles.css lets the drag through to it.
 */
export function MoreTabs({ group }: IDockviewHeaderActionsProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    const header = anchor.current?.closest<HTMLElement>('.dv-tabs-and-actions-container')
    const row = header?.querySelector<HTMLElement>('.dv-tabs-container')
    if (!header || !row) return
    const fit = () => {
      const tabs = [...row.children].filter((element): element is HTMLElement => element.classList.contains('dv-tab'))
      const panels = group.panels
      if (header.clientWidth === 0 || tabs.length !== panels.length) return
      // Every tab at its full width, measured, then those that do not fit left out, before anything is painted.
      row.classList.add('tabs-measuring')
      for (const tab of tabs) tab.classList.remove('tab-hidden')
      const widths = tabs.map((tab) => tab.getBoundingClientRect().width)
      const style = getComputedStyle(row)
      let room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      for (const part of header.querySelectorAll<HTMLElement>(':scope > .dv-pre-actions-container, :scope > .dv-left-actions-container')) room -= part.getBoundingClientRect().width
      const shown = tabsInView(widths, group.activePanel ? panels.indexOf(group.activePanel) : -1, room, MORE_WIDTH)
      tabs.forEach((tab, i) => tab.classList.toggle('tab-hidden', !shown[i]))
      row.classList.remove('tabs-measuring')
      const left = panels.filter((_, i) => !shown[i]).map((panel) => panel.id)
      setHidden((was) => (was.join('\n') === left.join('\n') ? was : left))
    }
    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(header)
    // Tabs added, taken away or moved, and titles changed with the language.
    const changed = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'characterData' || !(dropMark(record.target) || [...record.addedNodes, ...record.removedNodes].every(dropMark)))) fit()
    })
    changed.observe(row, { childList: true, subtree: true, characterData: true })
    const front = group.api.onDidActivePanelChange(fit)
    let gone = false
    header.ownerDocument.fonts?.ready.then(() => gone || fit())
    return () => {
      gone = true
      resized.disconnect()
      changed.disconnect()
      front.dispose()
    }
  }, [group])

  const shut = open && hidden.length === 0
  useEffect(() => {
    if (shut) setOpen(false)
  }, [shut])

  // Under the button, kept on screen.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return
    const at = button.current.getBoundingClientRect()
    const box = menu.current.getBoundingClientRect()
    setPosition({ left: Math.max(4, Math.min(at.left, window.innerWidth - box.width - 4)), top: at.bottom + 4 })
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
    <span ref={anchor} className="tab-more-anchor">
      {hidden.length > 0 && (
        <button ref={button} className="tab-more" title={t('More tabs')} aria-label={t('More tabs')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          <Ellipsis size={14} />
        </button>
      )}
      {open &&
        createPortal(
          <div ref={menu} className="menu-list context-menu tab-menu" role="menu" style={position}>
            {hidden.map((id) => {
              const panel = group.panels.find((p) => p.id === id)
              return (
                panel && (
                  <button
                    key={id}
                    role="menuitem"
                    onClick={() => {
                      setOpen(false)
                      panel.api.setActive()
                    }}
                  >
                    <span className="menu-title">{panel.title}</span>
                  </button>
                )
              )
            })}
          </div>,
          document.body,
        )}
    </span>
  )
}
