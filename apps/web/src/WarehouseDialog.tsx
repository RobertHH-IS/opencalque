import { Fragment, useEffect, useMemo, useState } from 'react'
import { applyOps, componentsOf, createDocument, declarativeExtension, importComponents, toSVG, type DeclarativeExtension, type Document, type Op, type ParametricKind } from '@opencalque/core'
import { Globe, HardDrive, Pencil, SlidersHorizontal, TextCursorInput, Trash2, X } from 'lucide-react'
import { DRAWING_EXTENSIONS, guarded, importLibraryFrom } from './actions'
import { carry, svgUrl } from './carry'
import { language, msg, t, tn } from './i18n'
import { platform } from './platform'
import { setPrefs, usePrefs } from './prefs'
import { BUILT_IN_EXTENSION, loadExtensions, registry, useExtensions } from './extensions'
import { editComponent } from './navigation'
import { apply, applyOrThrow, setTool, useStore } from './store'
import { toast, useWindows } from './windows'
import { IconButton } from './ui'
import { bundledExtensions, bundledLibraries, remoteCatalog, type Library } from './catalog'
import { formatLength, formatNumber, unitSuffix } from './units'

const close = () => useWindows.setState({ warehouse: null })

/** A text of an extension that is not installed yet, in the user's language when the extension provides it. */
const own = (extension: { translations?: Record<string, Record<string, string>> }, text: string) => extension.translations?.[language()]?.[text] ?? text

/** A drawing of a parametric object with its default sizes; a door or window is shown in a piece of wall. */
function objectPicture(kind: ParametricKind): string {
  try {
    const hole = kind.opening?.(registry.resolveProps(kind, {}))
    const ops: Op[] = [{ op: 'add_node', node: { type: 'parametric', parent: 'page_1', layer: 'layer_1', kind: kind.kind, x: 0, y: 0, rotation: 0, props: {} } }]
    if (hole) ops.unshift({ op: 'add_node', node: { type: 'wall', parent: 'page_1', layer: 'layer_1', a: { x: hole.from - 350, y: 0 }, b: { x: hole.to + 350, y: 0 }, thickness: 200 } })
    return svgUrl(toSVG(applyOps(createDocument(), ops), 'page_1', registry))
  } catch {
    return ''
  }
}

/** One thing that can be put on the drawing, whatever it is and wherever it comes from. */
interface Card {
  key: string
  group: string
  name: string
  /** One short line under its name: the size it comes at, or a short note. */
  description: string
  /** What its tooltip says about it besides how to place it, when that is more than its card shows. */
  about?: string
  picture: string
  /** Puts it on the pointer, to be placed on the drawing; `carried` while the card is being dragged there. */
  place(carried?: boolean): void
  /** Id of the component, for one that belongs to the drawing and can therefore be renamed, edited and deleted here. */
  own?: string
  /** A parametric object: its sizes and options are set once placed. Marked on its card. */
  parametric?: boolean
  /** The library a component of a library is in, and its id there. */
  library?: { id: string; component: string }
}

/** Where parametric objects that say no category, or one nothing else is in, are listed. */
const OBJECTS = 'objects'
const DRAWING = 'drawing'
/** Groups of parametric objects that no library is, by the category they say, and their names. */
const CATEGORIES: Record<string, string> = {
  architecture: msg('Architecture'),
  annotation: msg('Annotation'),
  living: msg('Living room'),
  dining: msg('Dining room'),
  bedroom: msg('Bedroom'),
  office: msg('Office'),
}
/**
 * The headings of the list of sections, each with the sections the app knows under it, in the
 * order they are listed (the rooms in the order of a home). A section of any other name, a library
 * from a web catalog for instance, comes after them, under Others, and the objects that say no
 * category last of all.
 */
const HEADINGS: [heading: string, sections: string[]][] = [
  [msg('Rooms'), ['living', 'dining', 'bedroom', 'kitchen', 'bathroom', 'office']],
  [msg('Building'), ['architecture', 'electrical']],
  [msg('Drawing'), ['annotation']],
]
const SECTION_KEY = 'opencalque.librarySection'

/** The size a parametric object is placed at, in the unit the user works in: its box, or its length along a wall. */
function defaultSize(kind: ParametricKind): string {
  try {
    const props = registry.resolveProps(kind, {})
    if (kind.box) {
      const box = kind.box.bounds(props)
      return `${formatNumber(box.right - box.left)} × ${formatNumber(box.bottom - box.top)} ${unitSuffix()}`.trim()
    }
    return kind.size ? formatLength(Number(props[kind.size.x])) : ''
  } catch {
    return ''
  }
}

/** The section of the object library looked at last, kept on this computer: the library opens on it again. */
function lastSection(): string {
  try {
    return localStorage.getItem(SECTION_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

/**
 * The object library: every object that can be placed, in one searchable grid. That is the
 * parametric objects of the extensions in use (doors, windows, stairs…), the components of the
 * drawing that is open, and those of each library of the warehouse.
 */
function Components({ libraries }: { libraries: Library[] }) {
  const doc = useStore((s) => s.doc)
  const version = useExtensions((s) => s.version)
  const [loaded, setLoaded] = useState<Record<string, Document>>({})
  const [chosenSection, setChosenSection] = useState(lastSection)
  const [search, setSearch] = useState('')
  /** The section a search is narrowed to: all of them when it starts, and not remembered. */
  const [searchSection, setSearchSection] = useState('all')
  // The sizes on the cards are in the unit the user works in.
  const lengthUnit = usePrefs((p) => p.unit)
  /** Key of the card whose name is being typed. */
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    for (const library of libraries) {
      library.load().then(
        (opened) => !stale && setLoaded((all) => ({ ...all, [library.id]: opened })),
        (error) => !stale && toast(t('This library could not be opened: {reason}', { reason: (error as Error).message })),
      )
    }
    return () => {
      stale = true
    }
  }, [libraries])

  /**
   * Copies components of a library into the drawing; with one, goes straight to placing it. What
   * comes in is the library's: a copy brought in before is reused only while nothing in it has
   * been changed, and one that was is left as another component of the drawing's own.
   */
  const add = (library: Document, ids: string[], from?: Library, carried?: boolean) =>
    guarded(() => {
      const result = importComponents(useStore.getState().doc, library, ids, { original: true })
      // What arrives in the drawing is named in the user's language, like what the library showed.
      const names = Object.values(result.imported).flatMap((id): Op[] => {
        const name = result.doc.nodes[id]?.name
        const shown = name && from ? own(from, name) : name
        return shown && shown !== name ? [{ op: 'update_node', id, patch: { name: shown } }] : []
      })
      applyOrThrow([...result.ops, ...names])
      close()
      if (ids.length === 1) setTool('place', { type: 'instance', component: result.imported[ids[0]], carried })
      else toast(tn(ids.length, '{n} component added. It is in the object library, under “In this drawing”.', '{n} components added. They are in the object library, under “In this drawing”.'))
    })

  // The sections: the drawing's own components first; then each library, split into the rooms its
  // components are for (the furniture into living room, dining room, bedroom and office), under
  // its own name for those that say none; and the sections parametric objects say. They are
  // listed under the headings of HEADINGS, the others after them. Parametric objects are listed
  // among the components of their kind (a table in the dining room), marked as such.
  const kinds = [...registry.parametric.values()]
  const sectionsOf = (library: Library) => {
    const rooms = Object.values(library.categories ?? {})
    const all = library.components !== undefined && rooms.length >= library.components
    return [...new Set(rooms), ...(all ? [] : [library.id])]
  }
  const present = new Set([...libraries.flatMap(sectionsOf), ...kinds.map((kind) => kind.category ?? OBJECTS)])
  const known = HEADINGS.flatMap(([, ids]) => ids)
  const rest = [...present].filter((id) => !known.includes(id)).sort((a, b) => Number(a === OBJECTS) - Number(b === OBJECTS))
  const lists = [...HEADINGS.map(([heading, ids]) => ({ heading, ids: ids.filter((id) => present.has(id)) })), { heading: msg('Others'), ids: rest }].filter((list) => list.ids.length > 0)
  const nameOf = (id: string) => {
    const library = libraries.find((l) => l.id === id)
    if (id === DRAWING) return t('In this drawing')
    if (id === OBJECTS) return t('Other objects')
    return library ? own(library, library.name) : CATEGORIES[id] ? t(CATEGORIES[id]) : t(id)
  }
  const groups = [DRAWING, ...lists.flatMap((list) => list.ids)].map((id) => ({ id, name: nameOf(id) }))

  // Pictures are the objects themselves, rendered the way the drawing renders them.
  const objectCards = useMemo(
    () =>
      [...registry.parametric.values()].map((kind): Card => ({
        key: `kind ${kind.kind}`,
        group: kind.category ?? OBJECTS,
        parametric: true,
        name: t(kind.label),
        // The size it comes at; how it is placed and changed is said by its tooltip.
        description: defaultSize(kind),
        about: kind.description ? t(kind.description) : undefined,
        picture: objectPicture(kind),
        place: (carried) => (close(), setTool('place', { type: 'parametric', kind: kind.kind, carried })),
      })),
    [version, lengthUnit],
  )
  const drawingCards = useMemo(
    () =>
      componentsOf(doc).map((c): Card => ({
        key: `drawing ${c.id}`,
        own: c.id,
        group: DRAWING,
        name: c.name ?? c.id,
        description: c.description ?? '',
        picture: svgUrl(toSVG(doc, c.id, registry)),
        place: (carried) => (close(), setTool('place', { type: 'instance', component: c.id, carried })),
      })),
    [doc, version],
  )
  const libraryCards = useMemo(
    () =>
      Object.entries(loaded).flatMap(([id, library]) => {
        const from = libraries.find((l) => l.id === id)
        return componentsOf(library).map((c): Card => ({
          key: `${id} ${c.id}`,
          group: from?.categories?.[c.id] ?? id,
          library: { id, component: c.id },
          name: from ? own(from, c.name ?? c.id) : (c.name ?? c.id),
          description: from ? own(from, c.description ?? '') : (c.description ?? ''),
          picture: svgUrl(toSVG(library, c.id, registry)),
          place: (carried) => add(library, [c.id], from, carried),
        }))
      }),
    [loaded, version, libraries],
  )

  /** Copies the components of a drawing on this computer into this one, and shows them where they now are. */
  const fromFile = () =>
    guarded(async () => {
      const file = await platform.open(DRAWING_EXTENSIONS)
      if (!file) return
      importLibraryFrom(file.name, file.content)
      setSearch('')
      setFilter(DRAWING)
    })

  const setFilter = (section: string) => {
    setChosenSection(section)
    try {
      localStorage.setItem(SECTION_KEY, section)
    } catch {
      // Without storage the library opens on All next time.
    }
  }
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const offered = (section: string) => section === 'all' || groups.some((group) => group.id === section)
  // A search looks through every section, narrowed to one only when one is chosen while searching.
  // Otherwise the section looked at last is shown, while there is something in it to show: not a
  // library that is no longer offered, nor the drawing's own components in a drawing that has none.
  const filter =
    words.length > 0 ? (offered(searchSection) ? searchSection : 'all') : offered(chosenSection) && (chosenSection !== DRAWING || drawingCards.length > 0) ? chosenSection : 'all'
  const choose = (section: string) => (words.length > 0 ? setSearchSection(section) : setFilter(section))

  // Every section with what it holds that matches the search, which the list of sections counts.
  const found = groups.map((group) => ({
    ...group,
    cards: [...objectCards, ...drawingCards, ...libraryCards].filter((card) => card.group === group.id && words.every((word) => `${card.name} ${card.description} ${group.name}`.toLowerCase().includes(word))),
  }))
  const counts: Record<string, number> = { all: 0 }
  for (const group of found) {
    counts[group.id] = group.cards.length
    counts.all += group.cards.length
  }
  const shown = found.filter((group) => (filter === 'all' || filter === group.id) && group.cards.length > 0)
  const loading = libraries.some((l) => !loaded[l.id])
  // The components of a library shown in one section, to be added to the drawing at once: all of
  // them when they are the whole library.
  const inSection = filter === 'all' ? [] : shown.flatMap((group) => group.cards).flatMap((card) => (card.library ? [card.library] : []))
  const source = inSection.length > 0 && inSection.every((one) => one.id === inSection[0].id) ? inSection[0].id : null
  const chosen = source ? loaded[source] : undefined
  const whole = chosen ? componentsOf(chosen).length === inSection.length : false

  /** One entry of the list of sections, with how many things it holds, or matches the search. */
  const section = (id: string, name: string) => (
    <button
      key={id}
      className={`warehouse-section${id === filter ? ' active' : ''}${counts[id] ? '' : ' empty'}`}
      aria-current={id === filter || undefined}
      title={((l) => l && own(l, l.description))(libraries.find((l) => l.id === id))}
      onClick={() => choose(id)}
    >
      <span className="warehouse-section-name">{name}</span>
      <span className="warehouse-count">{counts[id] ?? 0}</span>
    </button>
  )

  return (
    <>
      <div className="warehouse-bar">
        <input
          autoFocus
          placeholder={t('Search every object and component…')}
          value={search}
          onChange={(e) => {
            // A new search starts in every section.
            if (!search.trim()) setSearchSection('all')
            setSearch(e.target.value)
          }}
        />
        {/* The sections as a list to pick from, where the window is too narrow to show them beside what they hold. */}
        <select className="warehouse-section-picker" aria-label={t('Sections')} value={filter} onChange={(e) => choose(e.target.value)}>
          <option value="all">{t('All')}</option>
          <option value={DRAWING}>{nameOf(DRAWING)}</option>
          {lists.map(({ heading, ids }) => (
            <optgroup key={heading} label={t(heading)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="warehouse-body">
        <nav className="warehouse-sections" aria-label={t('Sections')}>
          {section('all', t('All'))}
          {section(DRAWING, nameOf(DRAWING))}
          {lists.map(({ heading, ids }) => (
            <Fragment key={heading}>
              <h5>{t(heading)}</h5>
              {ids.map((id) => section(id, nameOf(id)))}
            </Fragment>
          ))}
          {/* Where more comes from: a drawing on this computer, whose components join this one's, or a catalog on the web, whose libraries join these. */}
          <div className="warehouse-more">
            <h5>{t('More components')}</h5>
            <button className="warehouse-section" title={t('Copies the components of a drawing on this computer into this one, under “In this drawing”')} onClick={fromFile}>
              <HardDrive size={13} />
              <span className="warehouse-section-name">{t('From a file…')}</span>
            </button>
            <details className="warehouse-web">
              <summary className="warehouse-section">
                <Globe size={13} />
                <span className="warehouse-section-name">{t('From the web…')}</span>
              </summary>
              <CatalogAddress bare />
            </details>
          </div>
        </nav>
        <div className="warehouse-grid">
          {shown.map((group) => (
            <Fragment key={group.id}>
              <h4 className="warehouse-heading">
                <span className="warehouse-heading-name">{group.name}</span>
                {chosen && group.id === filter && (
                  <button className="text-button" onClick={() => add(chosen, inSection.map((one) => one.component), libraries.find((l) => l.id === source))}>
                    {whole ? t('Add the whole library') : t('Add all of these')}
                  </button>
                )}
              </h4>
              {group.cards.map((card) => (
                <div
                  key={card.key}
                  className="warehouse-card"
                  role="button"
                  tabIndex={0}
                  // Its name and what its card has no room for, then how to place it.
                  title={[card.name, card.about ?? card.description, t('Click, then click on the drawing to place it, or drag it onto the drawing')].filter(Boolean).join('\n\n')}
                  onClick={() => card.place()}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && card.place()}
                  // Dragged a few pixels, the library closes and the card's content follows the pointer.
                  onPointerDown={(e) => carry(e, card.place)}
                  // Dragged, the card is what it holds, not a picture to drop as a file.
                  onDragStart={(e) => e.preventDefault()}
                >
                  {card.picture ? <img src={card.picture} alt="" draggable={false} /> : <span className="warehouse-blank" />}
                  {card.parametric && (
                    <span className="warehouse-badge" title={t('Parametric: its sizes and options are set once it is placed, in its properties or by pulling its sides')}>
                      <SlidersHorizontal size={11} />
                    </span>
                  )}
                  {renaming === card.key && card.own ? (
                    <input
                      className="inline-input"
                      autoFocus
                      defaultValue={card.name}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        setRenaming(null)
                        const name = e.target.value.trim()
                        if (name && name !== card.name) apply([{ op: 'update_node', id: card.own!, patch: { name } }])
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Escape') e.currentTarget.value = card.name
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                      }}
                    />
                  ) : (
                    <strong>{card.name}</strong>
                  )}
                  <span className="faint">{card.description}</span>
                  {card.own && (
                    // What can be done to a component of the drawing, besides placing it.
                    <span className="warehouse-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton title={t('Rename')} onClick={() => setRenaming(card.key)}>
                        <TextCursorInput size={13} />
                      </IconButton>
                      <IconButton title={t('Edit component')} onClick={() => (close(), editComponent(card.own!))}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton title={t('Delete component and its instances')} onClick={() => apply([{ op: 'remove_node', id: card.own! }])}>
                        <Trash2 size={13} />
                      </IconButton>
                    </span>
                  )}
                </div>
              ))}
            </Fragment>
          ))}
          {shown.length === 0 && <p className="hint">{loading ? t('Loading…') : filter === DRAWING && words.length === 0 ? t('This drawing has no component yet. Select objects and choose Object › Make into a component.') : t('Nothing matches.')}</p>}
        </div>
      </div>
    </>
  )
}

function Extensions({ catalog }: { catalog: DeclarativeExtension[] }) {
  const { installed, disabled } = usePrefs((p) => p.extensions)
  useExtensions((s) => s.version)
  // Installed extensions stay listed even when no catalog offers them any more.
  const all = [...catalog, ...Object.values(installed).filter((e) => !catalog.some((c) => c.id === e.id))]

  const change = (next: { installed?: typeof installed; disabled?: string[] }) => {
    setPrefs({ extensions: { installed, disabled, ...next } })
    loadExtensions()
  }
  const install = (extension: DeclarativeExtension) =>
    guarded(() => {
      // Building it is the validation: a broken extension is refused here, not at the next start.
      declarativeExtension(extension)
      change({ installed: { ...installed, [extension.id]: extension } })
      toast(t('{name} installed. Its objects are in the object library.', { name: own(extension, extension.name) }))
    })
  const remove = (id: string) => {
    const { [id]: _, ...rest } = installed
    change({ installed: rest })
  }
  const fromFile = () =>
    guarded(async () => {
      const file = await platform.open(['json'])
      if (!file) return
      const extension = JSON.parse(file.content)
      declarativeExtension(extension)
      await install(extension)
    })
  const builtInOn = !disabled.includes(BUILT_IN_EXTENSION)

  return (
    <>
      <div className="warehouse-list">
        <div className="warehouse-row">
          <div>
            <strong>{t('Architecture')}</strong> <span className="faint">{t('built in')}</span>
            <p className="hint">{t('Doors, windows, stairs, washbasins, a bathtub, a hob, a sink, fridges and a corner sofa.')}</p>
          </div>
          <button className="pill" onClick={() => change({ disabled: builtInOn ? [...disabled, BUILT_IN_EXTENSION] : disabled.filter((id) => id !== BUILT_IN_EXTENSION) })}>
            {builtInOn ? t('Turn off') : t('Turn on')}
          </button>
        </div>
        {all.map((extension) => (
          <div key={extension.id} className="warehouse-row">
            <div>
              <strong>{own(extension, extension.name)}</strong> <span className="faint">{extension.version}</span>
              {extension.description && <p className="hint">{own(extension, extension.description)}</p>}
              <p className="hint">{extension.objects.map((o) => own(extension, o.label)).join(' · ')}</p>
            </div>
            {installed[extension.id] ? (
              <button className="pill" onClick={() => remove(extension.id)}>
                {t('Remove')}
              </button>
            ) : (
              <button className="pill active" onClick={() => install(extension)}>
                {t('Install')}
              </button>
            )}
          </div>
        ))}
      </div>
      <footer className="warehouse-footer">
        <span className="hint">{t('These extensions are data, not programs: they describe objects and cannot run code, so installing one is safe.')}</span>
        <button className="text-button" onClick={fromFile}>
          {t('Install from a file…')}
        </button>
      </footer>
    </>
  )
}

/** What can be added: what ships with the app, and what the web catalog the user gave offers. Read only while `active`. */
function useCatalog(active: boolean) {
  const catalogUrl = usePrefs((p) => p.catalogUrl)
  const [remote, setRemote] = useState<{ libraries: Library[]; extensions: DeclarativeExtension[] }>({ libraries: [], extensions: [] })
  const libraries = useMemo(() => [...bundledLibraries(), ...remote.libraries], [remote])
  const extensions = useMemo(() => [...bundledExtensions(), ...remote.extensions], [remote])

  useEffect(() => {
    if (!active || !catalogUrl) return setRemote({ libraries: [], extensions: [] })
    let stale = false
    remoteCatalog(catalogUrl).then(
      (catalog) => !stale && setRemote(catalog),
      (error) => !stale && toast(t('The catalog could not be read: {reason}', { reason: (error as Error).message })),
    )
    return () => {
      stale = true
    }
  }, [active, catalogUrl])
  return { libraries, extensions }
}

/** The address of a catalog on the web that offers more libraries and extensions; `bare` where something else already says what it is for. */
function CatalogAddress({ bare = false }: { bare?: boolean }) {
  const catalogUrl = usePrefs((p) => p.catalogUrl)
  const [url, setUrl] = useState(catalogUrl)
  return (
    <form
      className="warehouse-catalog"
      onSubmit={(e) => {
        e.preventDefault()
        setPrefs({ catalogUrl: url.trim() })
      }}
    >
      {!bare && <span className="faint">{t('More from a web catalog')}</span>}
      <input placeholder="https://…/catalog.json" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="pill" type="submit">
        {t('Load')}
      </button>
    </form>
  )
}

/** The extensions that can be installed, removed and switched off. It is a page of Preferences, not a window of its own. */
export function ExtensionWarehouse() {
  const { extensions } = useCatalog(true)
  return (
    <div className="prefs-extensions">
      <Extensions catalog={extensions} />
      <CatalogAddress />
    </div>
  )
}

/** The object library: everything that can be placed, from the drawing, the app and a web catalog. */
export function Warehouse() {
  const open = useWindows((s) => s.warehouse) === 'components'
  const { libraries } = useCatalog(open)

  if (!open) return null
  return (
    <div className="palette-backdrop" onMouseDown={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog warehouse" role="dialog" aria-label={t('Object library')} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('Object library')}</h2>
          {/* Nothing is to be confirmed here: the window is only closed, as Escape or a click beside it does. */}
          <IconButton title={t('Close')} onClick={close}>
            <X size={16} />
          </IconButton>
        </header>
        <Components libraries={libraries} />
      </div>
    </div>
  )
}
