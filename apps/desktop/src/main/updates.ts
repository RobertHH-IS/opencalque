import { app, BrowserWindow, net, type WebContents } from 'electron'
import { AppImageUpdater, NsisUpdater, type AppUpdater } from 'electron-updater'
import type { UpdateState } from '../../../web/src/updateState'
import { isNewer } from './version'

/*
 * Newer versions of the app. The Windows setup and the Linux AppImage replace themselves through
 * electron-updater: the new version is downloaded in the background from its release on GitHub
 * (the app-update.yml that electron-builder writes into the installed app, from `publish` in
 * package.json, says where), checked against the sha512 that the release's latest.yml gives for
 * it, and installed when the app closes, or at once from "Restart to update". The builds are not
 * signed, so no signature is checked. macOS replaces only a signed app, and the portable Windows
 * app has nowhere to be installed: there the newest release is looked up, and its page offered.
 *
 * Nothing is looked up until the window asks: it holds the preference that says whether to at start.
 */

/** Where the releases are published. */
const REPOSITORY = 'laurent512/opencalque'

let state: UpdateState = { status: 'idle' }
const listeners = new Set<WebContents>()
/** What replaces the app, where it can be replaced; made at the first check. */
let updater: AppUpdater | null | undefined
/** Whether the windows are being closed to install the update. */
let installing = false

function tell(next: UpdateState): void {
  state = next
  for (const contents of listeners) if (!contents.isDestroyed()) contents.send('update:state', state)
}

/** Remembers a window that wants to hear of a new version, and tells it what is known already. */
export function listen(contents: WebContents): void {
  if (!listeners.has(contents)) contents.once('destroyed', () => listeners.delete(contents))
  listeners.add(contents)
  contents.send('update:state', state)
}

function selfUpdater(): AppUpdater | null {
  if (!app.isPackaged) return null
  let made: AppUpdater
  if (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE) made = new NsisUpdater()
  else if (process.platform === 'linux' && process.env.APPIMAGE) made = new AppImageUpdater()
  else return null
  // The releases hold whole installers, not the small web installer that fetches the rest.
  made.disableWebInstaller = true
  made.on('update-available', (info) => tell({ status: 'downloading', version: info.version }))
  made.on('update-downloaded', (info) => tell({ status: 'ready', version: info.version }))
  // Failures reach `lookUp` through its promises. An installer that could not be started must
  // not leave the app running with no window.
  made.on('error', () => installing && app.quit())
  return made
}

/** The newest release that is not a pre-release, or null when there is none. */
async function latestRelease(): Promise<{ version: string; url: string } | null> {
  const response = await net.fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}.`)
  const tag = ((await response.json()) as { tag_name?: unknown }).tag_name
  const version = typeof tag === 'string' ? tag.replace(/^v/, '') : ''
  // Only the version is taken from the answer; the page offered is made here.
  if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) return null
  return { version, url: `https://github.com/${REPOSITORY}/releases/tag/v${version}` }
}

async function offerPage(): Promise<void> {
  const latest = await latestRelease()
  tell(latest && isNewer(latest.version, app.getVersion()) ? { status: 'available', ...latest } : { status: 'latest' })
}

async function lookUp(): Promise<void> {
  updater ??= selfUpdater()
  if (!updater) return offerPage()
  try {
    const result = await updater.checkForUpdates()
    if (!result?.isUpdateAvailable) return tell({ status: 'latest' })
    // The download started by itself; 'update-downloaded' says when it is done.
    await result.downloadPromise
  } catch (error) {
    // When the updater cannot do its part (a release without its latest.yml, a download cut
    // short), a newer version is still offered from its page.
    const latest = await latestRelease().catch(() => null)
    if (latest && isNewer(latest.version, app.getVersion())) return tell({ status: 'available', ...latest })
    throw error
  }
}

/** Looks for a newer version, once at a time; one already found is told again. */
export async function checkForUpdate(): Promise<void> {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return tell(state)
  tell({ status: 'checking' })
  try {
    await lookUp()
  } catch (error) {
    tell({ status: 'failed', message: String((error as Error)?.message ?? error).split('\n')[0].slice(0, 200) })
  }
}

/** Closes every window to install the downloaded version; each asks first about unsaved changes. */
export function installUpdate(): void {
  if (state.status !== 'ready' || !updater) return
  installing = true
  for (const win of BrowserWindow.getAllWindows()) win.close()
}

/** A window was kept open: the update waits for the app to close. */
export function keptOpen(): void {
  installing = false
}

/**
 * Once every window has closed, installs the update and starts the new version when that is why
 * they closed. Says whether it did; the app then quits by itself.
 */
export function installOnClose(): boolean {
  if (!installing || !updater) return false
  updater.quitAndInstall(true, true)
  return true
}
