import { ChevronLeft, ChevronRight, ScanEye, X } from 'lucide-react'
import { instancesOf, selectInstancesHere, stepInstance, stopBrowsing } from './actions/instances'
import { entryName } from './entries'
import { t } from './i18n'
import { useStore } from './store'
import { IconButton } from './ui'
import { useWindows } from './windows'

/**
 * The bar over the canvas while the placements of an entry are gone through: which component or model,
 * which of how many is shown, the one before and after (Alt+← and Alt+→), the placements where
 * the editing is to select at once, and the way out (Escape). It takes the place of the hints.
 */
export function InstanceBar() {
  const browsing = useWindows((s) => s.browsing)
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  if (!browsing) return null
  const list = instancesOf(doc, browsing.entry)
  if (list.length === 0) return null
  const at = list.findIndex((node) => node.id === browsing.current)
  const here = list.filter((node) => node.parent === scope).length
  const name = entryName(doc, browsing.entry)
  return (
    <div className="instance-bar" role="toolbar" aria-label={t('Instances of {name}', { name })}>
      <ScanEye size={14} />
      <strong>{name}</strong>
      <IconButton title={`${t('Previous instance')} (Alt+←)`} disabled={list.length < 2} onClick={() => stepInstance(-1)}>
        <ChevronLeft size={14} />
      </IconButton>
      <span className="instance-count">
        {at < 0 ? '–' : at + 1} / {list.length}
      </span>
      <IconButton title={`${t('Next instance')} (Alt+→)`} disabled={list.length < 2} onClick={() => stepInstance(1)}>
        <ChevronRight size={14} />
      </IconButton>
      {here > 1 && (
        <button type="button" className="text-button" onClick={selectInstancesHere}>
          {t('Select the {n} here', { n: here })}
        </button>
      )}
      <IconButton title={`${t('Stop going through them')} (Esc)`} onClick={stopBrowsing}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
