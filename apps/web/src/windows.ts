import { create } from 'zustand'

/**
 * The windows laid over the editor, and the message shown at its foot. They are no part of the
 * drawing or of what is being done to it, so they live apart from the editor's store; opening a
 * drawing closes them all (`loadDocument`).
 */
interface Windows {
  welcomeOpen: boolean
  preferencesOpen: boolean
  /** The page Preferences opens on next, when something asked for one; otherwise the one it was left on. */
  preferencesPage: string | null
  exportOpen: boolean
  aboutOpen: boolean
  /** Whether the component library is open. */
  warehouse: 'components' | null
  toast: string | null
}

const CLOSED: Windows = { welcomeOpen: false, preferencesOpen: false, preferencesPage: null, exportOpen: false, aboutOpen: false, warehouse: null, toast: null }

export const useWindows = create<Windows>(() => CLOSED)

/** Closes every window and lets the message go. */
export function closeWindows(): void {
  useWindows.setState(CLOSED)
}

/** Shows a message at the foot of the editor for a few seconds. */
export function toast(message: string): void {
  useWindows.setState({ toast: message })
  setTimeout(() => useWindows.getState().toast === message && useWindows.setState({ toast: null }), 4000)
}
