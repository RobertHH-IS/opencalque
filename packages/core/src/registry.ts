import type { ModifierKind } from './modifiers'
import type { Op } from './ops'
import type { Primitive } from './primitives'
import type { Document } from './schema'

export interface ParamDef {
  key: string
  label: string
  type: 'number' | 'boolean' | 'string'
  default: number | boolean | string
  /** For a string parameter: the allowed values, shown as a dropdown. */
  options?: string[]
  /** Set on a number that is a length in mm, so editors can show and take it in the user's unit. */
  unit?: 'length'
}

/** What a parametric object can know about its surroundings when it is drawn. */
export interface BuildEnv {
  /** Thickness of the wall the object sits in, when it is an opening placed on one. */
  wallThickness?: number
}

/** An object type drawn from parameters. `build` returns primitives in local coordinates (origin = insertion point). */
export interface ParametricKind {
  kind: string
  label: string
  description?: string
  /**
   * Where the component library lists it, among the components of the same kind: a room
   * ('living', 'dining', 'bedroom', 'office'), one of the libraries' ids ('bathroom', 'kitchen',
   * 'electrical'), 'architecture' or 'annotation'; any other is a section of its own. Left out, it
   * is listed with the other objects.
   */
  category?: string
  params: ParamDef[]
  /**
   * Makes the object a wall opening (door, window): the stretch of its local X axis that it cuts
   * out of a wall it is placed on. Such objects also snap to walls when placed or dragged.
   */
  opening?(props: Record<string, any>): { from: number; to: number }
  /**
   * The length parameter that is its size along its own X axis, from its insertion point: a door's
   * or a window's width. With it, the object is stretched on the canvas by the two ends of that
   * size, each moving alone, rather than scaled as a whole.
   */
  size?: { x: string }
  /**
   * The object as a box to resize on the canvas, as a rectangle is, its knob above turning it.
   * `bounds` is the box it fills in its own coordinates (the insertion point at 0, 0); `resize`
   * gives the parameters that make it fill a box of another width or height (only what changed is
   * given), rounded to what it can be: whole steps for a stair. The object is then placed so that
   * the side or corner held still stays where it was.
   */
  box?: {
    bounds(props: Record<string, any>): { left: number; top: number; right: number; bottom: number }
    resize(props: Record<string, any>, size: { width?: number; height?: number }): Record<string, unknown>
  }
  build(props: Record<string, any>, env: BuildEnv): Primitive[]
}

/** What a command can see and do. Documents are immutable: changes go through `apply`. */
export interface CommandHost {
  doc: Document
  /** The page or component currently being edited. */
  scope: string
  selection: string[]
  /** The layer new objects go on; none inside a component, whose content takes the layer of each placement. */
  activeLayer?: string
  apply(ops: Op[]): void
}

export interface Command {
  id: string
  title: string
  run(host: CommandHost): void
}

export interface ExtensionApi {
  registerParametric(kind: ParametricKind): void
  registerCommand(command: Command): void
  registerModifier(kind: ModifierKind): void
}

export interface Extension {
  id: string
  name: string
  version: string
  /**
   * Translations of the texts this extension shows (labels, descriptions, option names, command
   * titles), by language code and then by the English text. Option values stored in documents
   * stay in English; only what is displayed is translated.
   */
  translations?: Record<string, Record<string, string>>
  activate(api: ExtensionApi): void
}

export class Registry {
  readonly extensions: Extension[] = []
  readonly parametric = new Map<string, ParametricKind>()
  readonly commands = new Map<string, Command>()
  /** Modifier kinds contributed by extensions. The built-in ones are not in here; see `modifierKind`. */
  readonly modifiers = new Map<string, ModifierKind>()
  /** The translations of every extension in use, merged, by language code. */
  readonly translations: Record<string, Record<string, string>> = {}
  /** Goes up whenever the set of extensions changes, so that what was worked out with the old set is not reused. */
  version = 0

  use(extension: Extension): this {
    this.version++
    extension.activate({
      registerParametric: (kind) => this.parametric.set(kind.kind, kind),
      registerCommand: (command) => this.commands.set(command.id, command),
      registerModifier: (kind) => this.modifiers.set(kind.type, kind),
    })
    for (const [language, texts] of Object.entries(extension.translations ?? {})) {
      this.translations[language] = { ...this.translations[language], ...texts }
    }
    this.extensions.push(extension)
    return this
  }

  /** Forgets every extension, so a different set can be put in use. The registry object stays the same. */
  clear(): this {
    this.version++
    this.extensions.length = 0
    this.parametric.clear()
    this.commands.clear()
    this.modifiers.clear()
    for (const language of Object.keys(this.translations)) delete this.translations[language]
    return this
  }

  /** Props of a parametric node completed with the kind's defaults. */
  resolveProps(kind: ParametricKind, props: Record<string, unknown>): Record<string, any> {
    const out: Record<string, unknown> = {}
    for (const p of kind.params) {
      const value = props[p.key]
      const valid = typeof value === typeof p.default && (!p.options || p.options.includes(value as string))
      out[p.key] = valid ? value : p.default
    }
    return out
  }
}
