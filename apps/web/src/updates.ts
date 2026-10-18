import { create } from 'zustand'
import { t } from './i18n'
import { platform, type UpdateState } from './platform'
import { usePrefs } from './prefs'
import { VERSION } from './release'
import { toast } from './windows'

/**
 * What is known of a newer version of the desktop app; the looking is done by its main process
 * (apps/desktop/src/main/updates.ts). The menu bar shows a version that is ready or out. What was
 * found is said in a message only when the user asked, not after the look taken at start.
 */
export const useUpdate = create<UpdateState>(() => ({ status: 'idle' }))

/** Set when the user asked, until what was found has been said. */
let asked = false

function message(state: UpdateState): string | null {
  switch (state.status) {
    case 'latest':
      return t('OpenCalque {version} is the newest version.', { version: VERSION })
    case 'available':
      return t('Version {version} is out. Click it at the top of the window to download it.', { version: state.version })
    case 'downloading':
      return t('Version {version} is being downloaded. It will be installed when OpenCalque closes.', { version: state.version })
    case 'ready':
      return t('Version {version} is ready. It will be installed when OpenCalque closes.', { version: state.version })
    case 'failed':
      return t('Could not look for a new version: {reason}', { reason: state.message })
    default:
      return null
  }
}

/** Hears from the desktop app from now on, and looks for a new version when the preference says to. Called once, before the first render. */
export function startUpdates(): void {
  if (!platform.onUpdate) return
  platform.onUpdate((state) => {
    useUpdate.setState(state, true)
    const said = asked ? message(state) : null
    if (!said) return
    asked = false
    toast(said)
  })
  if (usePrefs.getState().checkUpdates) platform.checkForUpdate?.()
}

/** Looks for a new version now, and says what was found. */
export function checkForUpdate(): void {
  asked = true
  toast(t('Looking for a new version…'))
  platform.checkForUpdate?.()
}
