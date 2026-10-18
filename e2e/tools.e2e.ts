import { expect, test, type Page } from '@playwright/test'
import { canvas, drawWall, failOnErrors, openEditor, recordSaves, startWith } from './support'

/**
 * Each tool of the canvas, and each drag of the select tool, used as a person would, with what it
 * made read back from the drawing as it is saved. A blank drawing opens at 0.1 pixel per
 * millimetre with its origin 320 pixels across and 220 down the canvas, and its grid of 100 mm
 * falls on every tenth pixel from there, which is where these tests click.
 */

failOnErrors()

type Saved = { type: string; [key: string]: any }

/** Where a point of a blank drawing is on the page. */
async function blank(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  await startWith(page)
  await recordSaves(page)
  await openEditor(page)
  const box = (await canvas(page).boundingBox())!
  return (x, y) => ({ x: box.x + 320 + x / 10, y: box.y + 220 + y / 10 })
}

const click = (page: Page, p: { x: number; y: number }) => page.mouse.click(p.x, p.y)

/** Drags from one point to another, slowly enough to count as a drag rather than a click whose hand slipped. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.waitForTimeout(250)
  await page.mouse.up()
}

/** What the drawing holds, as saved now. */
async function saved(page: Page): Promise<Saved[]> {
  const count: number = await page.evaluate(() => (window as any).saves.length)
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(count + 1)
  const doc = JSON.parse(await page.evaluate(() => (window as any).saves.at(-1)))
  return Object.values(doc.nodes as Record<string, Saved>).filter((node) => node.type !== 'page')
}

const status = (page: Page) => page.locator('.status span').nth(1)

test('draws a line, and a closed shape by coming back to its first point, with the line tool', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('l')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  await page.keyboard.press('Escape')
  await click(page, at(0, 2000))
  await click(page, at(1000, 2000))
  await click(page, at(1000, 3000))
  await click(page, at(0, 2000))
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'line')).toEqual([expect.objectContaining({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } })])
  expect(nodes.filter((n) => n.type === 'polyline')).toEqual([
    expect.objectContaining({
      closed: true,
      points: [
        { x: 0, y: 2000 },
        { x: 1000, y: 2000 },
        { x: 1000, y: 3000 },
      ],
    }),
  ])
})

test('closes a run of walls back to where it started with a double-click on its last corner', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  await click(page, at(0, 0))
  await click(page, at(3000, 0))
  await click(page, at(3000, 2000))
  await page.mouse.dblclick(at(3000, 2000).x, at(3000, 2000).y)
  await page.keyboard.press('Escape')
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls).toHaveLength(3)
  expect(walls).toContainEqual(expect.objectContaining({ a: { x: 3000, y: 2000 }, b: { x: 0, y: 0 } }))
})

test('draws a rectangle by dragging and an ellipse by two clicks', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await drag(page, at(0, 0), at(2000, 1000))
  await page.keyboard.press('o')
  await click(page, at(3000, 0))
  await click(page, at(5000, 1000))
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'rect')).toMatchObject({ x: 0, y: 0, width: 2000, height: 1000 })
  expect(nodes.find((n) => n.type === 'ellipse')).toMatchObject({ cx: 4000, cy: 500, rx: 1000, ry: 500 })
})

test('writes a text where it is clicked, and a note with a leader to what it is about', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('t')
  await click(page, at(0, 0))
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+T')
  await click(page, at(2000, 0))
  await click(page, at(3000, -1000))
  await page.keyboard.type('Note')
  await page.keyboard.press('Escape')
  const nodes = await saved(page)
  expect(nodes.find((n) => n.type === 'text')).toMatchObject({ x: 0, y: 0, text: 'Hello' })
  expect(nodes.find((n) => n.type === 'annotation')).toMatchObject({ a: { x: 2000, y: 0 }, b: { x: 3000, y: -1000 }, text: 'Note' })
})

test('lays a paper at a standard format by pulling towards its corner', async ({ page }) => {
  await blank(page)
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('f')
  // The first corner, at the origin, stays where it is while the view steps back until an A3 fits half its width.
  await page.mouse.click(box.x + 320, box.y + 220)
  const zoom = (0.5 * box.width) / 42000
  await page.mouse.move(box.x + 320 + 42000 * zoom, box.y + 220 + 29700 * zoom, { steps: 5 })
  await page.mouse.click(box.x + 320 + 42000 * zoom, box.y + 220 + 29700 * zoom)
  expect((await saved(page)).find((n) => n.type === 'paper')).toMatchObject({ x: 0, y: 0, width: 42000, height: 29700, scale: 100 })
})

test('names the rooms that closed walls make, and splits one with a divider', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await click(page, at(x, y))
  await page.keyboard.press('Shift+A')
  await click(page, at(2000, 0))
  await click(page, at(2000, 3000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  for (const [x, y] of [[1000, 1500], [3000, 1500]]) {
    await page.mouse.move(at(x, y).x, at(x, y).y)
    await click(page, at(x, y))
  }
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'wall')).toHaveLength(4)
  expect(nodes.filter((n) => n.type === 'divider')).toEqual([expect.objectContaining({ a: { x: 2000, y: 0 }, b: { x: 2000, y: 3000 } })])
  expect(nodes.filter((n) => n.type === 'room').map((n) => [n.x, n.y])).toEqual([
    [1000, 1500],
    [3000, 1500],
  ])
})

test('cuts a wall in two with the split tool', async ({ page }) => {
  const at = await blank(page)
  await drawWall(page, [320, 220], [720, 220])
  await page.keyboard.press('k')
  await page.mouse.move(at(2000, 0).x, at(2000, 0).y)
  await click(page, at(2000, 0))
  const walls = (await saved(page)).filter((n) => n.type === 'wall')
  expect(walls.map((w) => [w.a, w.b])).toEqual(
    expect.arrayContaining([
      [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
      [{ x: 2000, y: 0 }, { x: 4000, y: 0 }],
    ]),
  )
})

test('turns the selection a quarter about a point with the rotate tool', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(2000, 1000))
  await page.keyboard.press('v')
  await click(page, at(1000, 1000))
  await page.keyboard.press('e')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  // Up the screen is a quarter turn counter-clockwise, as angles are read; the drawing keeps it clockwise, as 270°.
  await page.mouse.move(at(0, -1000).x, at(0, -1000).y, { steps: 5 })
  await expect(status(page)).toHaveText('Rotation 90°')
  await click(page, at(0, -1000))
  expect((await saved(page)).find((n) => n.type === 'rect')).toMatchObject({ x: 0, y: 0, width: 2000, height: 1000, rotation: 270 })
})

test('reads a distance and an angle without adding anything', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('m')
  await click(page, at(0, 0))
  await page.mouse.move(at(3000, 0).x, at(3000, 0).y, { steps: 5 })
  await expect(status(page)).toContainText('Distance 3000')
  await click(page, at(3000, 0))
  await page.keyboard.press('Shift+M')
  await click(page, at(0, 0))
  await click(page, at(1000, 0))
  await page.mouse.move(at(0, -1000).x, at(0, -1000).y, { steps: 5 })
  await expect(status(page)).toHaveText(/^Angle (90° · 270|270° · 90)°$/)
  await click(page, at(0, -1000))
  expect(await saved(page)).toEqual([])
})

test('selects what a box is dragged around, then scales it all by a corner of the box around it', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 1000))
  await click(page, at(2000, 0))
  await click(page, at(3000, 1000))
  await page.keyboard.press('v')
  // A box from beside them takes in both.
  await drag(page, at(-500, -500), at(3500, 1500))
  // The bottom-right corner of the box around them, pulled to twice as far from the top-left one.
  await drag(page, at(3000, 1000), at(6000, 2000))
  const rects = (await saved(page)).filter((n) => n.type === 'rect')
  expect(rects.map((r) => [r.x, r.y, r.width, r.height])).toEqual([
    [0, 0, 2000, 2000],
    [4000, 0, 2000, 2000],
  ])
})

test('drags a wall corner, both walls following, and the end of a line by its handle', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('w')
  for (const [x, y] of [[0, 0], [3000, 0], [3000, 2000]]) await click(page, at(x, y))
  await page.keyboard.press('Escape')
  await page.keyboard.press('l')
  await click(page, at(0, 3000))
  await click(page, at(2000, 3000))
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await drag(page, at(3000, 0), at(4000, -1000))
  await click(page, at(1000, 3000))
  await drag(page, at(2000, 3000), at(2000, 4000))
  const nodes = await saved(page)
  expect(nodes.filter((n) => n.type === 'wall').map((w) => [w.a, w.b])).toEqual([
    [{ x: 0, y: 0 }, { x: 4000, y: -1000 }],
    [{ x: 4000, y: -1000 }, { x: 3000, y: 2000 }],
  ])
  expect(nodes.find((n) => n.type === 'line')).toMatchObject({ a: { x: 0, y: 3000 }, b: { x: 2000, y: 4000 } })
})

test('moves an object by dragging it, by whole steps of the grid', async ({ page }) => {
  const at = await blank(page)
  await page.keyboard.press('r')
  await click(page, at(0, 0))
  await click(page, at(1000, 1000))
  await page.keyboard.press('v')
  await drag(page, at(500, 0), at(2500, 1000))
  expect((await saved(page)).find((n) => n.type === 'rect')).toMatchObject({ x: 2000, y: 1000, width: 1000, height: 1000 })
})
