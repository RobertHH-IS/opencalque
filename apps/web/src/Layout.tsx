import { useEffect, type FunctionComponent } from 'react'
import { DockviewReact, getPanelData, themeLight, type DockviewApi, type DockviewGroupPanel, type DockviewReadyEvent, type DockviewTheme, type DockviewWillShowOverlayLocationEvent } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { PANELS, registerDock, useDock, type PanelId } from './dock'
import { Guard } from './Guard'
import { MoreTabs } from './MoreTabs'
import { t } from './i18n'
import { AssistantPanel } from './panels/AssistantPanel'
import { Colors, Components, Layers, Objects, Pages } from './panels/LeftPanel'
import { WallTypes } from './panels/WallTypesPanel'
import { DimensionStyles } from './panels/DimensionStylesPanel'
import { Properties } from './panels/properties/Properties'
import { Stage } from './Stage'

const STORAGE_KEY = 'opencalque.layout'
const CANVAS = 'canvas'
/** Where the panels that existed when the layout was last saved are listed, to tell a new panel from a closed one. */
const KNOWN_KEY = 'opencalque.layout.panels'
/** A column narrower than this is not offered to be split into two side by side. */
const SPLIT_MIN_WIDTH = 520

/**
 * How dragging a panel looks: the tabs stay where they are and a short bar (styles.css) marks
 * where the tab will land, and the area a panel would take is outlined rather than only tinted.
 * The library's other way, tabs sliding apart around a gap, moved them under the pointer as it
 * went, and lost a drop let go of once they had slid.
 */
const THEME: DockviewTheme = {
  ...themeLight,
  dndTabIndicator: 'line',
  tabAnimation: 'default',
  dndPanelOverlay: 'content',
  dndOverlayBorder: '2px solid var(--dv-active-sash-color)',
}

const scrolling = (id: PanelId, Panel: FunctionComponent) => () => (
  <div className="dock-panel" data-panel={id}>
    <Guard area={title(id)}>
      <Panel />
    </Guard>
  </div>
)

/** A panel that fails shows a note in its place; the others, and the drawing, carry on. */
const guarded = (area: () => string, Panel: FunctionComponent) => () => (
  <Guard area={area()}>
    <Panel />
  </Guard>
)

const COMPONENTS: Record<PanelId | typeof CANVAS, FunctionComponent> = {
  canvas: guarded(() => t('The drawing area'), Stage),
  pages: scrolling('pages', Pages),
  layers: scrolling('layers', Layers),
  components: scrolling('components', Components),
  objects: scrolling('objects', Objects),
  colors: scrolling('colors', Colors),
  wallTypes: scrolling('wallTypes', WallTypes),
  dimensionStyles: scrolling('dimensionStyles', DimensionStyles),
  properties: scrolling('properties', Properties),
  assistant: guarded(() => title('assistant'), AssistantPanel),
}

/** Where a panel goes when it is opened and its usual neighbours are closed too. */
const SIDE: Record<PanelId, 'left' | 'right'> = { pages: 'left', layers: 'left', components: 'left', objects: 'left', colors: 'left', wallTypes: 'left', dimensionStyles: 'left', properties: 'right', assistant: 'right' }
/** The panel each one shares tabs with by default. */
const PARTNER: Record<PanelId, PanelId> = { pages: 'layers', layers: 'pages', components: 'layers', objects: 'colors', colors: 'objects', wallTypes: 'colors', dimensionStyles: 'wallTypes', properties: 'assistant', assistant: 'properties' }

const title = (id: PanelId) => t(PANELS[id])

/** The drawing has no tab strip and cannot be closed. */
function pinCanvas(api: DockviewApi): void {
  const canvas = api.getPanel(CANVAS)
  if (canvas) canvas.group.header.hidden = true
}

/**
 * Leaves out the drop zones that would give a useless result, so the ones offered while dragging
 * are all sensible:
 * - on the drawing, a panel can dock along a side but never becomes a tab of it;
 * - a narrow column is not split into two narrower ones; panels there stack or share tabs;
 * - a tab is shown no place in its own row that would leave it where it is (`leavesInPlace`).
 */
function limitDropZones(api: DockviewApi): void {
  api.onWillShowOverlay((event) => {
    const group = event.group
    if (!group) return
    if (group.id === api.getPanel(CANVAS)?.group.id) {
      if (event.kind !== 'content' || event.position === 'center') event.preventDefault()
    } else if (event.kind === 'content' && (event.position === 'left' || event.position === 'right') && group.element.clientWidth < SPLIT_MIN_WIDTH) {
      event.preventDefault()
    } else if ((event.kind === 'tab' || event.kind === 'header_space') && leavesInPlace(event, group)) {
      event.preventDefault()
    }
  })
}

/**
 * Whether a tab dropped here would stay where it is: on either side of itself, or after the last
 * tab when it is the last. No bar is shown there, and letting go does nothing.
 */
function leavesInPlace(event: DockviewWillShowOverlayLocationEvent, group: DockviewGroupPanel): boolean {
  const data = event.getData()
  if (!data?.panelId || data.groupId !== group.id) return false
  const from = group.panels.findIndex((panel) => panel.id === data.panelId)
  let to = group.panels.length
  if (event.kind === 'tab') {
    // The event names the group's tab in front, not the one under the pointer.
    const { clientX, clientY } = event.nativeEvent as MouseEvent
    const tab = document.elementFromPoint(clientX, clientY)?.closest('.dv-tab')
    const tabs = [...(tab?.parentElement?.children ?? [])].filter((element) => element.classList.contains('dv-tab'))
    if (!tab || !tabs.includes(tab)) return false
    to = tabs.indexOf(tab) + (event.position === 'right' ? 1 : 0)
  }
  return to === from || to === from + 1
}

/**
 * Panels are dragged with pointer events (`dndStrategy="pointer"`) rather than the browser's drag
 * and drop, whose cursor on Windows said "not allowed" as a drag began and at every edge between
 * two elements on the way: the browser asks the page too late. While one is dragged, the page has
 * the class `dock-dragging`, which keeps one cursor over everything and the tabs without hover.
 * Returns what stops it.
 */
function markDrags(): () => void {
  const root = document.documentElement
  const move = (event: PointerEvent) => root.classList.toggle('dock-dragging', event.buttons !== 0 && getPanelData() !== undefined)
  const end = () => root.classList.remove('dock-dragging')
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', end, true)
  window.addEventListener('pointercancel', end, true)
  return () => {
    end()
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
  }
}

function arrange(api: DockviewApi): void {
  api.clear()
  api.addPanel({ id: CANVAS, component: CANVAS, title: '' })
  const add = (id: PanelId, position: { referencePanel: string; direction: 'left' | 'right' | 'below' | 'within' }, initialWidth?: number) =>
    api.addPanel({ id, component: id, title: title(id), position, initialWidth })
  add('layers', { referencePanel: CANVAS, direction: 'left' }, 250)
  add('pages', { referencePanel: 'layers', direction: 'within' })
  add('components', { referencePanel: 'layers', direction: 'within' })
  add('objects', { referencePanel: 'layers', direction: 'below' })
  add('colors', { referencePanel: 'objects', direction: 'within' })
  add('wallTypes', { referencePanel: 'objects', direction: 'within' })
  add('dimensionStyles', { referencePanel: 'objects', direction: 'within' })
  add('properties', { referencePanel: CANVAS, direction: 'right' }, 290)
  add('assistant', { referencePanel: 'properties', direction: 'within' })
  for (const front of ['layers', 'objects', 'properties']) api.getPanel(front)?.api.setActive()
  pinCanvas(api)
}

/**
 * A remembered arrangement without the panels this version no longer has (a panel can be retired,
 * as Assets was when the object library replaced it). Null when taking them out would leave an
 * empty group, in which case the default arrangement is the safer choice.
 */
function withoutUnknownPanels(saved: any): any | null {
  const known = (id: string) => id === CANVAS || id in PANELS
  const gone = Object.keys(saved?.panels ?? {}).filter((id) => !known(id))
  if (gone.length === 0) return saved
  let emptied = false
  const prune = (data: any) => {
    data.views = (data.views ?? []).filter(known)
    if (!known(data.activeView)) data.activeView = data.views[0]
    if (data.views.length === 0) emptied = true
  }
  const walk = (node: any) => {
    if (node?.type === 'leaf') prune(node.data)
    else for (const child of node?.data ?? []) walk(child)
  }
  walk(saved.grid?.root)
  for (const group of [...(saved.floatingGroups ?? []), ...(saved.popoutGroups ?? [])]) prune(group.data)
  for (const id of gone) delete saved.panels[id]
  return emptied ? null : saved
}

function restore(api: DockviewApi): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return arrange(api)
    const layout = withoutUnknownPanels(JSON.parse(saved))
    if (!layout) return arrange(api)
    api.fromJSON(layout)
    if (!api.getPanel(CANVAS)) return arrange(api)
    // Titles are saved in the language they were created in.
    for (const panel of api.panels) if (panel.id in PANELS) panel.api.setTitle(title(panel.id as PanelId))
    pinCanvas(api)
  } catch {
    arrange(api)
  }
}

/**
 * The drawing surrounded by panels that can be dragged to another edge, dropped onto another panel
 * to share its tabs, pulled out to float, resized and closed, as in a code editor. The arrangement
 * is remembered on this computer.
 */
export function Layout() {
  useEffect(() => () => registerDock(null), [])
  useEffect(markDrags, [])

  const onReady = ({ api }: DockviewReadyEvent) => {
    restore(api)
    limitDropZones(api)
    const remember = () => {
      useDock.setState({ open: api.panels.map((p) => p.id) })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()))
        localStorage.setItem(KNOWN_KEY, JSON.stringify(Object.keys(PANELS)))
      } catch {
        // Storage can be unavailable (private windows); the layout then lasts for this session.
      }
    }
    const show = (id: PanelId) => {
      const existing = api.getPanel(id)
      if (existing) return existing.api.setActive()
      const partner = api.getPanel(PARTNER[id])
      const position = partner ? { referencePanel: partner.id, direction: 'within' as const } : { referencePanel: CANVAS, direction: SIDE[id] }
      api.addPanel({ id, component: id, title: title(id), position, initialWidth: partner ? undefined : 270 })
    }
    // A panel added to the app since the layout was saved is not in it: it is opened beside its
    // usual neighbour, behind it, so that it is found without disturbing what was arranged.
    try {
      const known: string[] = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? 'null') ?? (localStorage.getItem(STORAGE_KEY) ? ['pages', 'layers', 'objects', 'properties', 'assistant'] : Object.keys(PANELS))
      for (const id of Object.keys(PANELS) as PanelId[]) {
        if (known.includes(id) || api.getPanel(id)) continue
        const front = api.getPanel(PARTNER[id])
        show(id)
        front?.api.setActive()
      }
    } catch {
      // Without storage there is no saved layout either: every panel is already there.
    }
    remember()
    api.onDidLayoutChange(remember)
    registerDock({
      show,
      // A panel hidden behind another tab is brought forward; only one in view is closed.
      toggle: (id) => {
        const existing = api.getPanel(id)
        if (existing?.api.isVisible) api.removePanel(existing)
        else show(id)
      },
      reset: () => arrange(api),
    })
  }

  // A row of tabs never scrolls: those that do not fit are behind the "···" of `MoreTabs`, and
  // neither the library's scroll bar nor its own list of them is wanted.
  return <DockviewReact className="dock" theme={THEME} dndStrategy="pointer" scrollbars="native" disableTabsOverflowList rightHeaderActionsComponent={MoreTabs} components={COMPONENTS} onReady={onReady} />
}
