/**
 * What the desktop app knows of a newer version of itself. Where it can replace itself (the
 * Windows setup, the Linux AppImage) it downloads the new version and installs it when it closes;
 * elsewhere (macOS, the portable Windows app) it can only point to the release page. A file of
 * its own, free of the DOM, so that the desktop app's main process can share it.
 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'latest' }
  | { status: 'available'; version: string; url: string }
  | { status: 'downloading'; version: string }
  | { status: 'ready'; version: string }
  | { status: 'failed'; message: string }
