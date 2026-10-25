import { roundCorners, transformPrimitive, type ParamDef, type ParametricKind, type Primitive, type Vec2 } from '@opencalque/core'

/* What the objects of the extension are drawn with: line weights, shapes, limits, and the parameters several of them take. */

export const THIN = { strokeWidth: 0.5 }
export const HEAVY = { strokeWidth: 2 }
/** Wall thickness assumed for an opening that is not on a wall. */
export const LOOSE_WALL = 200

export const pt = (x: number, y: number): Vec2 => ({ x, y })
export const line = (points: Vec2[], style: { strokeWidth?: number; dash?: number[] } = {}): Primitive => ({ kind: 'path', points, ...style })
export const outline = (points: Vec2[], style: { strokeWidth?: number } = {}): Primitive => ({ kind: 'path', points, closed: true, ...style })
export const atLeast = (min: number, value: number) => Math.max(min, value)
/** The most steps a stair draws: a value typed by mistake, or written in a file, must not freeze the app drawing a million treads. */
const MAX_STEPS = 500
export const count = (value: number) => (Number.isFinite(value) ? Math.min(MAX_STEPS, Math.max(1, Math.round(value))) : 1)
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The most bowls a washbasin or a sink takes. */
export const MAX_BOWLS = 4

/** Mirrors left and right within a span of `width`. */
export const mirrorAlong = (prims: Primitive[], width: number) => prims.map((p) => transformPrimitive(p, { x: width, y: 0, flipX: true }))
/** Mirrors across the X axis, i.e. to the other side of the wall. */
export const mirrorAcross = (prims: Primitive[]) => prims.map((p) => transformPrimitive(p, { x: 0, y: 0, flipX: true, rotation: 180 }))

export const WIDTH: ParamDef = { key: 'width', label: 'Width', type: 'number', default: 900, unit: 'length' }
export const STEPS = (n: number): ParamDef => ({ key: 'steps', label: 'Steps', type: 'number', default: n })
export const TREAD: ParamDef = { key: 'tread', label: 'Tread depth', type: 'number', default: 270, unit: 'length' }
export const TURN: ParamDef = { key: 'turn', label: 'Turn', type: 'string', default: 'Right', options: ['Right', 'Left'] }
/** How high an opening is. Nothing of a plan is drawn with it; it is what the opening takes out of a wall's face. */
export const HEIGHT = (mm: number): ParamDef => ({ key: 'height', label: 'Height', type: 'number', default: mm, unit: 'length' })
export const OTHER_SIDE: ParamDef = { key: 'flip', label: 'Other side', type: 'boolean', default: false }
export const DEPTH = (mm: number): ParamDef => ({ key: 'depth', label: 'Depth', type: 'number', default: mm, unit: 'length' })

/** A box resized by its sides: `x` and `y` the keys of its width and its depth, the width made no less than `min` and the depth no less than `minDepth` (`min` unless said). */
export const sizedBox = (x: string, y: string, min: number, minDepth = min): NonNullable<ParametricKind['box']> => ({
  bounds: (props) => ({ left: 0, top: 0, right: atLeast(1, props[x]), bottom: atLeast(1, props[y]) }),
  resize: (_, size) => ({
    ...(size.width === undefined ? {} : { [x]: Math.round(atLeast(min, size.width)) }),
    ...(size.height === undefined ? {} : { [y]: Math.round(atLeast(minDepth, size.height)) }),
  }),
})
/** A rectangle from (x0, y0) to (x1, y1) with its corners rounded, one radius for all or one for each, clockwise from the top left. */
export const roundBox = (x0: number, y0: number, x1: number, y1: number, radius: number | number[], style: { strokeWidth?: number } = {}): Primitive =>
  outline(roundCorners([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)], radius), style)
export const circle = (cx: number, cy: number, r: number, style: { strokeWidth?: number } = {}): Primitive => ({ kind: 'ellipse', cx, cy, rx: r, ry: r, ...style })
