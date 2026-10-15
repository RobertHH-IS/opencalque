import { type NodeOf, type Node, type Op, newId, resolveColor, autoJoinCuts, cornerJoin, cornerJoinOps, endLineOps, endLineShown, withEdge, type WallEdge, moveCornerOps, wallEndsAt, wallArc, wallLength, wallJustifyOps } from '@opencalque/core'
import { executeById } from '../../commands'
import { useEffect, type ReactNode } from 'react'
import { Link2, Undo2 } from 'lucide-react'
import { showPanel } from '../../dock'
import { msg, t } from '../../i18n'
import { registry } from '../../extensions'
import { apply, selectCorner, useStore } from '../../store'
import { ColorChoice } from '../../ColorChoice'
import { WeightChoice } from '../../WeightChoice'
import { DashPicker, Field, IconButton, JustifyPicker, Section } from '../../ui'
import { formatLength } from '../../units'

/* What the Properties panel shows of walls: their line, type and curve, their ends and lines, and a selected corner. */

/**
 * The wall type of the selected walls: one of the drawing's types, none, or a new type made from
 * the wall as it is. A wall of a type is as thick as its type, whatever is typed for it.
 */
/** What each line a wall can be drawn by does, said where it is chosen. */
const WALL_LINES = {
  left: msg('By its left face: the corners are on that face, and the wall lies to the other side of it'),
  center: msg('By its middle: the wall lies equally on both sides of its corners'),
  right: msg('By its right face: the corners are on that face, and the wall lies to the other side of it'),
}

/**
 * Which line of the selected walls their corners are on: their middle, or one of their faces.
 * Changing it keeps the line, and the corners and walls joined there, where they are: the wall
 * moves to the other side of it. Pointing at a face shows it on the drawing, as left and right
 * depend on the way the wall was drawn.
 */
export function WallLine({ walls }: { walls: NodeOf<'wall'>[] }) {
  const values = new Set(walls.map((wall) => wall.justify ?? 'center'))
  const value = values.size === 1 ? [...values][0] : undefined
  const give = (justify: 'left' | 'center' | 'right') => {
    const { doc } = useStore.getState()
    apply(walls.flatMap((wall) => (doc.nodes[wall.id]?.type === 'wall' ? wallJustifyOps(doc, doc.nodes[wall.id] as NodeOf<'wall'>, justify, registry) : [])))
  }
  const point = (justify: 'left' | 'center' | 'right' | null) =>
    useStore.setState({ edgeHover: walls.length === 1 && (justify === 'left' || justify === 'right') ? { wall: walls[0].id, edge: justify } : null })
  return (
    <div className="field">
      <span>{t('Reference line')}</span>
      <JustifyPicker value={value} names={{ left: t(WALL_LINES.left), center: t(WALL_LINES.center), right: t(WALL_LINES.right) }} label={t('Reference line')} onPick={give} onHover={point} />
    </div>
  )
}

export function WallTypeChoice({ walls }: { walls: Extract<Node, { type: 'wall' }>[] }) {
  const doc = useStore((s) => s.doc)
  const types = Object.values(doc.wallTypes ?? {})
  const current = walls.every((wall) => wall.wallType === walls[0].wallType) ? (walls[0].wallType ?? '') : 'mixed'
  const give = (value: string) => {
    if (value === 'new') {
      const id = newId('walltype')
      apply([
        { op: 'add_wall_type', wallType: { id, name: t('Wall type {n}', { n: types.length + 1 }), thickness: walls[0].thickness } },
        ...walls.map((wall): Op => ({ op: 'update_node', id: wall.id, patch: { wallType: id } })),
      ])
      showPanel('wallTypes')
    } else apply(walls.map((wall): Op => ({ op: 'update_node', id: wall.id, patch: { wallType: value || null } })))
  }
  return (
    <>
      <label className="field">
        <span>{t('Wall type')}</span>
        <select value={current} onChange={(e) => give(e.target.value)}>
          {current === 'mixed' && <option value="mixed">{t('Mixed')}</option>}
          <option value="">{t('No type')}</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
          <option value="new">{t('New type from this wall…')}</option>
        </select>
      </label>
      {current !== '' && current !== 'mixed' && <p className="hint">{t('It takes what its type defines, shown with a link. A value typed here instead is an exception, and the arrow beside it gives it back to the type.')}</p>}
    </>
  )
}

/** How to curve a wall, and for one that is curved, the circle it follows. */
export function WallCurve({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const arc = wallArc(wall)
  if (!arc) return <p className="hint">{t('To curve the wall, drag the handle in its middle sideways, or type under Curve how far its middle should bow.')}</p>
  return <p className="hint">{t('Curved: radius {radius}, {length} round the curve. Set Curve to 0 to straighten it.', { radius: formatLength(arc.radius), length: formatLength(wallLength(wall)) })}</p>
}

/** The kinds of joint a corner of two walls can have. */
/**
 * The ways two walls can be joined, each with its name and a small picture of the corner. In the
 * pictures the tinted wall is "this wall" where the joint is chosen for one wall: the one that
 * passes, or the one that stops.
 */
type JointChoice = 'auto' | 'miter' | 'round' | 'bevel' | 'through' | 'butt'

const JOINT_PICTURES: Record<JointChoice, { name: string; own?: string; lines: string }> = {
  // Automatic has no picture of its own: it shows what it comes to at the corner's angle (see `JointPicker`).
  auto: { name: msg('Automatic: a sharp corner, cut off when the angle is too sharp'), lines: 'M5 16V4h18M11 16v-6h12' },
  miter: { name: msg('Sharp corner, at any angle'), lines: 'M5 16V4h18M11 16v-6h12' },
  round: { name: msg('Rounded'), lines: 'M5 16V10a6 6 0 0 1 6-6h12M11 16v-6h12' },
  bevel: { name: msg('Cut off, at any angle'), lines: 'M5 16V8.5L9.5 4H23M11 16v-6h12' },
  through: { name: msg('This wall runs past the other'), own: 'M5 4h18v6H5z', lines: 'M5 4h18M5 10h18M5 4v6M5 16v-6M11 16v-6' },
  butt: { name: msg('This wall stops against the other'), own: 'M11 4h12v6H11z', lines: 'M5 16V4h6v12M11 4h12M11 10h12' },
}

/** A row of small pictures of joints to pick one from, like the ends of a line. */
function JointPicker(props: { choices: JointChoice[]; value: JointChoice | undefined; names?: Partial<Record<JointChoice, string>>; cuts?: boolean; onPick: (value: JointChoice) => void }) {
  return (
    <div className="end-picker joint-picker" role="radiogroup">
      {props.choices.map((choice) => {
        const name = t(props.names?.[choice] ?? JOINT_PICTURES[choice].name)
        return (
          <button key={choice} type="button" role="radio" aria-checked={choice === props.value} className={choice === props.value ? 'active' : ''} title={name} aria-label={name} onClick={() => props.onPick(choice)}>
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
              {JOINT_PICTURES[choice].own && <path d={JOINT_PICTURES[choice].own} fill="currentColor" fillOpacity="0.22" stroke="none" />}
              {/* Automatic is drawn as what it gives here and now, sharp or cut off, with an "A" to say it chose. */}
              <path d={choice === 'auto' && props.cuts ? JOINT_PICTURES.bevel.lines : JOINT_PICTURES[choice].lines} />
              {choice === 'auto' && (
                <text x="20.5" y="19" fontSize="8" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">
                  A
                </text>
              )}
            </svg>
          </button>
        )
      })}
    </div>
  )
}

/**
 * How a wall is finished at each of its ends, said from the wall's own side: mitred, rounded, cut
 * off, simply meeting the other wall, running past it or stopping against it. An end is a corner
 * shared with another wall, so choosing here sets both walls, and they cannot disagree: when this
 * wall runs past, the other stops. An end that meets no wall, or more than one, has no choice to make.
 */
export function WallEnds({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const rows = (['a', 'b'] as const).map((end) => {
    const ends = wallEndsAt(doc, scope, wall[end])
    const mine = ends.findIndex((other) => other.wall.id === wall.id && other.end === end)
    if (ends.length !== 2 || mine < 0) return { end, note: ends.length < 2 ? t('free end') : t('{n} walls meet here, mitred', { n: ends.length }) }
    const joint = cornerJoin(ends)
    // A butt joint is one of two things for this wall: it is the one that passes, or the one that stops.
    const value: JointChoice = joint === 'butt' ? (wall.joins?.[end] === 'through' || (wall.joins?.[end] !== 'butt' && ends[1 - mine].wall.joins?.[ends[1 - mine].end] === 'butt') ? 'through' : 'butt') : joint
    const pick = (choice: JointChoice) => apply(choice === 'through' ? cornerJoinOps(ends, 'butt', mine) : choice === 'butt' ? cornerJoinOps(ends, 'butt', 1 - mine) : cornerJoinOps(ends, choice))
    return { end, value, pick, cuts: autoJoinCuts(ends) }
  })
  return (
    <>
      {rows.map((row) => (
        <div key={row.end} className="field">
          <span>{row.end === 'a' ? t('At its start') : t('At its end')}</span>
          {row.pick ? <JointPicker choices={['auto', 'miter', 'bevel', 'round', 'through', 'butt']} value={row.value} cuts={row.cuts} onPick={row.pick} /> : <em className="faint">{row.note}</em>}
        </div>
      ))}
    </>
  )
}

/**
 * The lines of a wall one by one, once its look is split: its two faces, as it runs from its
 * start to its end, and the lines across its two ends. Each can be hidden, and given a colour, a
 * weight and a kind of line of its own; what it leaves unset is the wall's. The line at an end
 * is shared with a wall joined there, so whether it is drawn is set for both.
 */
export function WallEdges({ wall }: { wall: Extract<Node, { type: 'wall' }> }) {
  const doc = useStore((s) => s.doc)
  const rows: { id: 'left' | 'right' | 'a' | 'b'; name: string; shown: boolean }[] = [
    { id: 'left', name: msg('Left face'), shown: wall.edges?.left?.show !== false },
    { id: 'right', name: msg('Right face'), shown: wall.edges?.right?.show !== false },
    { id: 'a', name: msg('At its start'), shown: endLineShown(doc, wall, 'a') },
    { id: 'b', name: msg('At its end'), shown: endLineShown(doc, wall, 'b') },
  ]
  // What a line takes when it says nothing: the wall's own look, else its type's, else the layer's colour.
  const type = wall.wallType ? doc.wallTypes?.[wall.wallType] : undefined
  const layer = wall.layer ? doc.layers[wall.layer] : undefined
  const inherited = {
    stroke: (resolveColor(doc, wall.style?.stroke ?? type?.stroke ?? layer?.color) as string | undefined) ?? '#1f1f1f',
    strokeWidth: wall.style?.strokeWidth ?? type?.strokeWidth ?? 1,
    dash: wall.style?.dash ?? type?.dash,
  }
  const set = (id: 'left' | 'right' | 'a' | 'b', change: Partial<WallEdge>) => {
    // Read afresh: a choice may change the drawing twice in a row (show the line, then give it a kind).
    const now = useStore.getState().doc
    const fresh = now.nodes[wall.id]
    if (fresh?.type !== 'wall') return
    // The line at an end joined to one other wall is one line for both: its look is given to both ends.
    const ends = id === 'a' || id === 'b' ? wallEndsAt(now, fresh.parent, fresh[id]) : []
    const owners = ends.length === 2 ? ends : [{ wall: fresh, end: id }]
    apply(
      owners.map(({ wall: owner, end }): Op => {
        const edge: Record<string, unknown> = { ...owner.edges?.[end], ...change }
        for (const key of Object.keys(edge)) if (edge[key] === undefined) delete edge[key]
        return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, edge as WallEdge) } }
      }),
    )
  }
  const show = (id: 'left' | 'right' | 'a' | 'b', shown: boolean) => (id === 'a' || id === 'b' ? apply(endLineOps(useStore.getState().doc, wall, id, shown)) : set(id, { show: shown ? undefined : false }))
  const point = (edge: 'left' | 'right' | 'a' | 'b' | null) => useStore.setState({ edgeHover: edge ? { wall: wall.id, edge } : null })
  // Once the panel goes (another selection, nothing selected), no line stays lit.
  useEffect(() => () => useStore.setState({ edgeHover: null }), [])
  /** A property row of a line: its value, and whether it is the line's own or taken from the wall. */
  const row = (label: string, own: boolean, reset: () => void, control: ReactNode) => (
    <div className={`typed-row${own ? ' own' : ''}`}>
      <div className="field">
        <span>{t(label)}</span>
        {control}
      </div>
      {own ? (
        <IconButton title={t('Its own. Click to take the wall’s again')} onClick={reset}>
          <Undo2 size={12} />
        </IconButton>
      ) : (
        <i className="typed-mark" title={t('Inherited from the wall')}>
          <Link2 size={11} />
        </i>
      )}
    </div>
  )
  return (
    <div className="wall-edges" onPointerLeave={() => point(null)}>
      {rows.map((line) => {
        const edge = wall.edges?.[line.id]
        return (
          <div key={line.id} className={`wall-edge${line.shown ? '' : ' off'}`} onPointerEnter={() => point(line.id)}>
            <div className="wall-edge-head">
              <strong>{t(line.name)}</strong>
              {!line.shown && <em className="faint">{t('no line')}</em>}
            </div>
            {row(
              'Line',
              // Not drawn because of how the joint is made is not the wall's own choice.
              edge?.dash !== undefined || edge?.show !== undefined,
              () => {
                if (line.id === 'left' || line.id === 'right') return set(line.id, { dash: undefined, show: undefined })
                // An end goes back to what its joint usually does, for both walls there.
                const ends = wallEndsAt(doc, wall.parent, wall[line.id])
                apply(
                  (ends.length === 2 ? ends : [{ wall, end: line.id }]).map(({ wall: owner, end }): Op => {
                    const { show: _, dash: __, ...look } = owner.edges?.[end] ?? {}
                    return { op: 'update_node', id: owner.id, patch: { edges: withEdge(owner.edges, end, look) } }
                  }),
                )
              },
              // No line is one of the kinds of line: the line is then not drawn at all.
              <DashPicker
                value={edge?.dash ?? inherited.dash}
                faint={edge?.dash === undefined && line.shown}
                hidden={{ chosen: !line.shown, onPick: () => show(line.id, false) }}
                onPick={(pattern) => {
                  if (!line.shown) show(line.id, true)
                  set(line.id, { dash: pattern ?? undefined, ...(line.id === 'left' || line.id === 'right' ? { show: undefined } : {}) })
                }}
              />,
            )}
            {line.shown && (
              <>
                {row(
                  'Color',
                  edge?.stroke !== undefined,
                  () => set(line.id, { stroke: undefined }),
                  <ColorChoice key={`${wall.id} ${line.id}`} stored={edge?.stroke} fallback={inherited.stroke} unset={msg('inherited')} commit={(stroke) => set(line.id, { stroke: stroke as string | undefined })} />,
                )}
                {row(
                  'Weight',
                  edge?.strokeWidth !== undefined,
                  () => set(line.id, { strokeWidth: undefined }),
                  <WeightChoice
                    key={`${wall.id} ${line.id}`}
                    value={edge?.strokeWidth ?? inherited.strokeWidth}
                    faint={edge?.strokeWidth === undefined}
                    label={t('Weight')}
                    onPick={(pixels) => set(line.id, { strokeWidth: pixels ?? undefined })}
                  />,
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A wall corner: the point where wall ends meet. It is not an object of the drawing, so what is
 * shown and changed here is written to the walls that meet there.
 */
export function CornerPanel({ at }: { at: { x: number; y: number } }) {
  const doc = useStore((s) => s.doc)
  const scope = useStore((s) => s.scope)
  const ends = wallEndsAt(doc, scope, at)
  if (ends.length === 0) return null
  const join = cornerJoin(ends)
  const passing = Math.max(0, ends.findIndex(({ wall, end }) => wall.joins?.[end] === 'through'))
  const move = (to: { x: number; y: number }) => {
    if (apply(moveCornerOps(doc, scope, at, to))) selectCorner(to)
  }
  return (
    <>
      <Section title={ends.length > 1 ? t('Corner') : t('Wall end')}>
        <p className="hint">{ends.length > 1 ? t('{n} walls meet here. Drag the corner, or type where it should be: they all follow.', { n: ends.length }) : t('The free end of a wall. Bring it onto another wall’s end to join them.')}</p>
        <Field label={t('X')} numeric length value={at.x} onCommit={(x) => move({ x, y: at.y })} />
        <Field label={t('Y')} numeric length value={at.y} onCommit={(y) => move({ x: at.x, y })} />
        {ends.length === 1 && (
          <div className="pill-row">
            <button className="pill" onClick={() => executeById('wall.extend')}>
              {t('Extend to the next wall')}
            </button>
            <button className="pill" onClick={() => executeById('wall.trim')}>
              {t('Trim back to a wall')}
            </button>
          </div>
        )}
      </Section>
      {ends.length === 2 && (
        <Section title={t('Joint')}>
          <div className="field">
            <span>{t('Type')}</span>
            {/* Seen from the corner there is one butt joint; which wall passes is chosen below. */}
            <JointPicker
              choices={['auto', 'miter', 'bevel', 'round', 'through']}
              cuts={autoJoinCuts(ends)}
              names={{ through: msg('One wall runs through') }}
              value={join === 'butt' ? 'through' : join}
              onPick={(choice) => apply(cornerJoinOps(ends, choice === 'through' ? 'butt' : (choice as Exclude<JointChoice, 'through' | 'butt'>), passing))}
            />
          </div>
          <label className="field">
            <span>{t('Line between them')}</span>
            <input type="checkbox" checked={endLineShown(doc, ends[0].wall, ends[0].end)} onChange={(e) => apply(endLineOps(doc, ends[0].wall, ends[0].end, e.target.checked))} />
          </label>
          {join === 'butt' && (
            <button className="text-button" onClick={() => apply(cornerJoinOps(ends, 'butt', passing === 0 ? 1 : 0))}>
              {t('Let the other wall run through')}
            </button>
          )}
        </Section>
      )}
      {ends.length > 2 && (
        <Section title={t('Joint')}>
          <p className="hint">{t('Where more than two walls meet, they are mitred together.')}</p>
        </Section>
      )}
    </>
  )
}
