import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * The editor in a browser, as people use it. Each test starts from a fresh profile: no drawing, no
 * settings, the welcome window turned off unless the test wants it.
 */

/** Settings stored before the app starts, as Preferences would store them. */
async function startWith(page: Page, prefs: Record<string, unknown> = {}) {
  await page.addInitScript((stored) => {
    if (!sessionStorage.getItem('started')) {
      localStorage.setItem('opencalque.prefs', JSON.stringify({ showWelcome: false, unit: 'mm', language: 'en', ...stored }))
      sessionStorage.setItem('started', '1')
    }
  }, prefs)
}

/**
 * Stands in for the browser's save dialog (File System Access API), which a test cannot answer:
 * every save is recorded in `window.saves` instead of written to disk.
 */
async function recordSaves(page: Page) {
  await page.addInitScript(() => {
    const saves: string[] = []
    ;(window as any).saves = saves
    ;(window as any).showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      name: suggestedName,
      createWritable: async () => {
        let content = ''
        return { write: async (data: unknown) => void (content = typeof data === 'string' ? data : '(bytes)'), close: async () => void saves.push(content) }
      },
    })
  })
}

const canvas = (page: Page) => page.locator('.stage canvas')
const objectRows = (page: Page) => page.locator('[data-panel="objects"] .row')
/** A section of the component library, in the list on its left, by its name. */
const librarySection = (page: Page, name: string) => page.locator('.warehouse-section', { has: page.locator('.warehouse-section-name', { hasText: new RegExp(`^${name}$`) }) })

/** Draws a wall from one point of the canvas to another, in CSS pixels from its top-left corner. */
async function drawWall(page: Page, from: [number, number], to: [number, number]) {
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('w')
  await page.mouse.click(box.x + from[0], box.y + from[1])
  await page.mouse.click(box.x + to[0], box.y + to[1])
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
}

/** Chooses a file for the next file dialog the page opens. */
async function choose(page: Page, open: () => Promise<void>, name: string, content: string) {
  const chooser = page.waitForEvent('filechooser')
  await open()
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(content) })
}

/**
 * Where a point of the drawing is on the page, for a drawing brought into view as it opened: read
 * from the status bar, which says where the pointer is in millimetres, at two places.
 */
async function drawingOnScreen(page: Page): Promise<(x: number, y: number) => [number, number]> {
  const box = (await canvas(page).boundingBox())!
  const reading = async (x: number, y: number) => {
    await page.mouse.move(box.x + x, box.y + y)
    const text = (await page.locator('.status span').nth(1).textContent())!.replaceAll(String.fromCharCode(0x2212), '-').replace(/[^\d.,-]/g, '')
    const [wx, wy] = text.split(',').map(Number)
    return { x: wx, y: wy }
  }
  const p = await reading(100, 100)
  const q = await reading(700, 500)
  const zoom = 600 / (q.x - p.x)
  return (x, y) => [box.x + 100 + (x - p.x) * zoom, box.y + 100 + (y - p.y) * zoom]
}

const drawing = (nodes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'opencalque',
    version: 1,
    id: 'doc_test',
    name: 'Test',
    unit: 'mm',
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order: 'a0' } },
    nodes: { page_1: { id: 'page_1', type: 'page', name: 'Page 1', parent: null, order: 'a0' }, ...nodes },
    ...extra,
  })

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  ;(page as any).errors = errors
})

test.afterEach(async ({ page }) => {
  // No script error and no Content-Security-Policy violation, whatever the test did.
  expect((page as any).errors).toEqual([])
})

test('draws a wall, undoes and redoes it', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await expect(objectRows(page)).toHaveCount(0)
  await drawWall(page, [300, 300], [700, 300])
  await expect(objectRows(page)).toHaveCount(1)
  await expect(objectRows(page).first()).toContainText('Wall')
  await page.keyboard.press('Control+z')
  await expect(objectRows(page)).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(objectRows(page)).toHaveCount(1)
})

test('saves a drawing, then saves each change by itself', async ({ page }) => {
  await startWith(page)
  await recordSaves(page)
  await page.goto('/')
  await drawWall(page, [300, 300], [700, 300])
  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (window as any).saves.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).saves[0])).toContain('"type": "wall"')
  await expect(page.locator('.menubar-saved')).toBeVisible()
  await drawWall(page, [300, 400], [700, 400])
  // Autosave waits for two seconds without changes.
  await expect.poll(() => page.evaluate(() => (window as any).saves.length), { timeout: 8000 }).toBe(2)
  expect((await page.evaluate(() => (window as any).saves[1])).match(/"type": "wall"/g)).toHaveLength(2)
})

test('opens a drawing that needs repairs, and says so; refuses one from a newer version', async ({ page }) => {
  await startWith(page)
  // "Discard unsaved changes?" before opening the second file.
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  const broken = drawing({ w: { id: 'w', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 200, wallType: 'missing' } })
  await choose(page, () => page.keyboard.press('Control+o'), 'broken.opencalque', broken)
  await expect(page.locator('.toast')).toContainText('One problem in broken.opencalque was put right')
  await expect(objectRows(page)).toHaveCount(1)
  // Still editable: a wall can be drawn next to it.
  await drawWall(page, [300, 500], [700, 500])
  await expect(objectRows(page)).toHaveCount(2)

  await choose(page, () => page.keyboard.press('Control+o'), 'future.opencalque', drawing({}, { version: 99 }))
  await expect(page.locator('.toast')).toContainText('future.opencalque was saved by a newer version of OpenCalque')
  await expect(objectRows(page)).toHaveCount(2)
})

test('pastes where one is looking: a cut thing back in place, a copy beside it, else in the middle of the view', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await drawWall(page, [300, 300], [700, 300])
  const x1 = page.locator('label.field', { has: page.locator('span:text-is("X1")') }).locator('input')
  await objectRows(page).first().click()
  await expect(x1).toHaveValue('-200')

  // Cut and pasted while in view, it comes back exactly where it was.
  await page.keyboard.press('Control+x')
  await expect(objectRows(page)).toHaveCount(0)
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(1)
  await expect(x1).toHaveValue('-200')

  // Copied, it is pasted beside the original, and the next paste beside that one: two steps of the 100 mm grid each time.
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(x1).toHaveValue('0')
  await page.keyboard.press('Control+v')
  await expect(x1).toHaveValue('200')

  // Looked at from elsewhere, it lands in the middle of the view.
  await page.mouse.move(box.x + 600, box.y + 400)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box.x + 1200, box.y + 400, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(4)
  const pasted = Number((await x1.inputValue()).replace(/\s/g, ''))
  // The view moved 600 px, 6 m at this zoom: the wall's place is now off to the right, out of sight.
  expect(pasted).toBeLessThan(-4000)
})

test('fills a shape with the colour of its layer, chosen in the colour window, which also has an eyedropper', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const fill = page.locator('[data-panel="properties"] .field', { has: page.locator('.color-now') }).nth(1)
  await fill.locator('.color-now').click()
  await expect(page.locator('.color-menu .color-eyedropper')).toBeVisible()
  // Not the layer's name: the Layer field above says which it is.
  await expect(page.locator('.color-menu')).not.toContainText('Layer 1')
  await page.locator('.color-menu .color-option', { hasText: 'Colour of the layer' }).click()
  // The field says what it follows, the whole of it: colour fields were cut to 72 pixels.
  await expect(fill.locator('.color-now')).toContainText('Layer')
  expect((await fill.locator('.color-now').boundingBox())!.width).toBeGreaterThan(120)
})

test('gives a colour an opacity, on a shape and on a shared colour', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const fill = page.locator('[data-panel="properties"] .field', { has: page.locator('.color-now') }).nth(1)
  await fill.locator('.color-now').click()
  await page.locator('.color-code input').fill('#e5484d')
  await page.locator('.color-code input').press('Enter')
  // Pressed straight after typing the code: the press counts, the code is not saved again over it.
  const slider = page.locator('.color-menu .color-alpha')
  const track = (await slider.boundingBox())!
  await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2)
  await expect(fill.locator('.color-now')).toContainText('#e5484d80')
  await expect(page.locator('.color-menu .color-opacity')).toContainText('50 %')

  // A shared colour is set in the same window, opacity included, and not linked to anything else.
  await page.keyboard.press('Escape')
  await page.locator('.dv-tab', { hasText: 'Colours' }).click()
  await page.locator('button[title="Add a shared colour"]').click()
  await page.locator('[data-panel="colors"] .row .color-now').first().click()
  await expect(page.locator('.color-menu .color-alpha')).toBeVisible()
  await expect(page.locator('.color-menu')).not.toContainText('New shared colour')
})

test('resizes a rectangle by the middles of its sides and its corners', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  const drag = async (from: [number, number], to: [number, number], shift = false) => {
    await page.mouse.move(box.x + from[0], box.y + from[1])
    if (shift) await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 })
    await page.mouse.up()
    if (shift) await page.keyboard.up('Shift')
  }
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('W')).toHaveValue('2000')
  // The middle of the right side: only the width changes, the left side stays.
  await drag([500, 350], [600, 350])
  await expect(field('W')).toHaveValue('3000')
  await expect(field('H')).toHaveValue('1000')
  await expect(field('X')).toHaveValue('-200')
  // The middle of the bottom side: only the height.
  await drag([450, 400], [450, 450])
  await expect(field('W')).toHaveValue('3000')
  await expect(field('H')).toHaveValue('1500')
  // A corner with Shift keeps the proportions.
  await drag([600, 450], [900, 500], true)
  await expect(field('W')).toHaveValue('6000')
  await expect(field('H')).toHaveValue('3000')
})

test('makes a wall thicker from one face, the other face staying where it was', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // At the first zoom (0.1 px/mm) a wall of 200 mm is 20 pixels thick: its middle line at y = 300, its faces at 290 and 310.
  await drawWall(page, [300, 300], [700, 300])
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Thickness')).toHaveValue('200')
  await expect(field('Y1')).toHaveValue('800')
  const box = (await canvas(page).boundingBox())!
  await page.mouse.move(box.x + 500, box.y + 291)
  await expect(page.locator('.hint-bar')).toContainText('Drag the face to make the wall thicker or thinner on this side')
  await page.mouse.down()
  await page.mouse.move(box.x + 500, box.y + 270, { steps: 4 })
  await page.mouse.move(box.x + 500, box.y + 250, { steps: 4 })
  await expect(page.locator('.hint-bar')).toContainText('The other face stays where it is')
  await page.mouse.up()
  // The upper face went up 400 mm: 600 thick, its middle 200 mm higher, its lower face still at 900.
  await expect(field('Thickness')).toHaveValue('600')
  await expect(field('Y1')).toHaveValue('600')
  await expect(field('Y2')).toHaveValue('600')
  // One step to undo.
  await page.keyboard.press('Control+z')
  await expect(field('Thickness')).toHaveValue('200')
  await expect(field('Y1')).toHaveValue('800')

  const drag = async (to: number, key: 'Control' | 'Alt') => {
    await page.mouse.move(box.x + 500, box.y + 291)
    await page.mouse.down()
    await page.keyboard.down(key)
    await page.mouse.move(box.x + 500, box.y + to, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up(key)
  }
  // Ctrl grows it both ways: 300 mm either side of a middle line that stays put.
  await drag(270, 'Control')
  await expect(field('Thickness')).toHaveValue('600')
  await expect(field('Y1')).toHaveValue('800')
  await page.keyboard.press('Control+z')
  // Alt, as everywhere, ignores the steps: 470 mm, where the steps of this zoom (50 mm) would give 450 or 500.
  await drag(263, 'Alt')
  await expect(field('Thickness')).toHaveValue('470')
  await expect(field('Y1')).toHaveValue('665')
})

test('draws a wall by its face and keeps it: thicker, it grows away; given another line, its corners stay', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('w')
  await page.getByTitle('Points along the right face of the wall').click()
  // Running east at y = 300 (800 mm), its right face is the line clicked: the wall lies north of it, from 280 to 300.
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 700, box.y + 300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
  await page.mouse.click(box.x + 500, box.y + 289)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const line = page.locator('.field', { has: page.locator('span:text-is("Reference line")') })
  await expect(field('Y1')).toHaveValue('800')
  await expect(line.locator('[aria-checked="true"]')).toHaveAttribute('title', /^By its right face/)
  // Thicker, it grows away from its line, which stays where it was clicked.
  await field('Thickness').fill('400')
  await field('Thickness').press('Enter')
  await expect(field('Y1')).toHaveValue('800')
  await expect(field('Y2')).toHaveValue('800')
  // By its middle now: the corners stay, the wall moves to straddle them.
  await line.getByTitle(/^By its middle/).click()
  await expect(line.locator('[aria-checked="true"]')).toHaveAttribute('title', /^By its middle/)
  await expect(field('Y1')).toHaveValue('800')
  await expect(field('Thickness')).toHaveValue('400')
})

test('with Shift, a wall being drawn keeps level and still stops on what it meets: a wall it crosses, a point it comes level with', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // An upright wall whose middle line is at x = 1830 mm, off the grid; and a short line ending at (3270, 2300).
  const plan = drawing({
    upright: { id: 'upright', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 1830, y: 0 }, b: { x: 1830, y: 2000 }, thickness: 200 },
    mark: { id: 'mark', type: 'line', parent: 'page_1', order: 'a2', a: { x: 3270, y: 2100 }, b: { x: 3270, y: 2300 } },
    // So that the view the drawing opens on takes in where the walls start.
    edge: { id: 'edge', type: 'line', parent: 'page_1', order: 'a3', a: { x: 0, y: 0 }, b: { x: 0, y: 2600 } },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  const onScreen = await drawingOnScreen(page)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  const drawHeld = async (from: [number, number], to: [number, number]) => {
    await page.keyboard.press('w')
    await page.mouse.click(...onScreen(...from))
    await page.keyboard.down('Shift')
    await page.mouse.move(...onScreen(...to), { steps: 4 })
    await page.mouse.click(...onScreen(...to))
    await page.keyboard.up('Shift')
    await page.keyboard.press('Escape')
    await page.keyboard.press('v')
    await objectRows(page).first().click()
  }
  // From the left, level, the pointer a little past the upright wall's middle line and a little low: it stops on that line.
  await drawHeld([1100, 1000], [1850, 1040])
  await expect(field('X2')).toHaveValue('1830')
  await expect(field('Y2')).toHaveValue('1000')
  // Level again, the pointer on the end of the line a little lower down: the wall ends level with it, at x = 3270.
  await drawHeld([1100, 1800], [3270, 2300])
  await expect(field('X2')).toHaveValue('3270')
  await expect(field('Y2')).toHaveValue('1800')
})

test('makes a wall longer by the line across its free end, in its own direction; its end point still moves it anywhere', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  // At 0.1 px/mm, the origin at (320, 220): a wall 200 thick from (-200, 800) to (1800, 800) mm, 20 px thick on screen.
  await drawWall(page, [300, 300], [500, 300])
  await page.mouse.click(box.x + 400, box.y + 300)
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X2')).toHaveValue('1800')
  // On its end line, 8 px off the point at its end: the pointer says sideways, and the hints what a drag does.
  await page.mouse.move(box.x + 500, box.y + 308)
  await expect(canvas(page)).toHaveCSS('cursor', 'ew-resize')
  await expect(page.locator('.hint-bar')).toContainText('Drag the end to make the wall longer or shorter')
  // Dragged out and down: it only gets longer, level as it was.
  await page.mouse.down()
  await page.mouse.move(box.x + 560, box.y + 340, { steps: 5 })
  await page.mouse.up()
  await expect(field('X2')).toHaveValue('2400')
  await expect(field('Y2')).toHaveValue('800')
  await expect(field('X1')).toHaveValue('-200')
  // The point at its end, dragged down, turns it (a press there picks that corner, so the wall is picked again to read it).
  await page.mouse.move(box.x + 560, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + 560, box.y + 340, { steps: 5 })
  await page.mouse.up()
  await page.mouse.click(box.x + 430, box.y + 320)
  await expect(field('X2')).toHaveValue('2400')
  await expect(field('Y2')).toHaveValue('1200')
})

test('stretches a window placed on a wall by either of its ends, the other staying put', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // At the first zoom (0.1 px/mm, the origin at 320, 220), a wall along y = 800 mm from x = -200 to 3800 mm.
  await drawWall(page, [300, 300], [700, 300])
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Window$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // Centred on the wall under the pointer, at x = 1800 mm: 1200 mm wide, it runs from 1200 to 2400 (440 to 560 on screen).
  await page.mouse.click(box.x + 500, box.y + 300)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Window' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Width')).toHaveValue('1200')
  await expect(field('X')).toHaveValue('1200')
  const drag = async (from: number, to: number) => {
    await page.mouse.move(box.x + from, box.y + 300)
    await page.mouse.down()
    await page.mouse.move(box.x + to, box.y + 305, { steps: 4 })
    await page.mouse.up()
  }
  // Its end, along the wall: wider, the start where it was.
  await drag(560, 600)
  await expect(field('Width')).toHaveValue('1600')
  await expect(field('X')).toHaveValue('1200')
  // Its start: the end stays where it was.
  await drag(440, 420)
  await expect(field('Width')).toHaveValue('1800')
  await expect(field('X')).toHaveValue('1000')
})

test('makes a stair longer by its top in whole steps, and wider by its side', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Stair, straight$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // At the first zoom (0.1 px/mm, the origin at 320, 220): its foot at (1800, 3800) mm, 900 wide and 12 steps of 270 up,
  // so on screen from x 500 to 590 and from y 276 to 600.
  await page.mouse.click(box.x + 500, box.y + 600)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Stair, straight' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Steps')).toHaveValue('12')
  const drag = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(box.x + from[0], box.y + from[1])
    await page.mouse.down()
    await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 })
    await page.mouse.up()
  }
  // Its top, up by a little over two treads: two more steps, its foot where it was.
  await drag([545, 276], [545, 220])
  await expect(field('Steps')).toHaveValue('14')
  await expect(field('Y')).toHaveValue('3800')
  // Its right side (whose middle is now at y = 411), 300 mm out.
  await drag([590, 411], [620, 411])
  await expect(field('Width')).toHaveValue('1200')
  await expect(field('X')).toHaveValue('1800')
})

test('brings a washbasin against a wall of a plan whose walls are grouped', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // A room of 5000 × 4000 mm whose walls, 200 thick, are grouped, the inside of its left wall at
  // x = 100; and a washbasin outside the group, turned with its back to that wall, at x = 1530.
  const wall = (id: string, order: string, a: [number, number], b: [number, number]) => ({ id, type: 'wall', parent: 'plan', order, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200 })
  const plan = drawing({
    plan: { id: 'plan', type: 'group', parent: 'page_1', order: 'a1' },
    left: wall('left', 'a0', [0, 0], [0, 4000]),
    bottom: wall('bottom', 'a1', [0, 4000], [5000, 4000]),
    right: wall('right', 'a2', [5000, 4000], [5000, 0]),
    top: wall('top', 'a3', [5000, 0], [0, 0]),
    basin: { id: 'basin', type: 'parametric', parent: 'page_1', order: 'a2', kind: 'arch.washbasin', props: {}, x: 1530, y: 2500, rotation: 270 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await expect(objectRows(page)).toHaveCount(2)
  const onScreen = await drawingOnScreen(page)
  // The washbasin fills x 1530 to 1980, y 1900 to 2500. Taken by a point on it away from its grips
  // and dragged 1410 mm to the left, its back comes 20 mm short of the wall's face: it goes against it.
  await page.mouse.move(...onScreen(1930, 2050))
  await page.mouse.down()
  await page.mouse.move(...onScreen(520, 2050), { steps: 6 })
  await page.mouse.up()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('100')
})

test('lists the furniture by room in the component library, the adjustable pieces with the rest', async ({ page }) => {
  // The adjustable furniture installed as 1.0.0-rc.3 shipped it, all of it listed as furniture: the copy that ships now replaces it.
  const furniture = JSON.parse(readFileSync('apps/web/src/warehouse/extensions/furniture.json', 'utf8'))
  const old = { ...furniture, version: '1.1.0', objects: furniture.objects.map((object: Record<string, unknown>) => ({ ...object, category: 'furniture' })) }
  await startWith(page, { extensions: { installed: { [old.id]: old }, disabled: [] } })
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  const sections = await page.locator('.warehouse-sections .warehouse-section-name').allTextContents()
  expect(sections.filter((name) => ['Living room', 'Dining room', 'Bedroom', 'Office', 'Furniture'].includes(name))).toEqual(['Living room', 'Dining room', 'Bedroom', 'Office'])
  await librarySection(page, 'Bedroom').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Bed', 'Double bed', 'Single bed', 'Wardrobe'])
  await librarySection(page, 'Dining room').click()
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Table with chairs', 'Chair', 'Dining table, six chairs'])
  // What is shown can be copied into the drawing at once.
  await page.getByRole('button', { name: 'Add all of these' }).click()
  await expect(page.locator('.toast')).toContainText('2 components added')
})

test('opens the component library on the section looked at last', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const library = page.getByTitle('Component library: stairs, furniture and every other object')
  const section = (name: string) => librarySection(page, name)
  const heading = (name: string) => page.locator('.warehouse-heading-name', { hasText: new RegExp(`^${name}$`) })
  await library.click()
  await expect(section('All')).toHaveClass(/active/)
  await section('Bathroom').click()
  await expect(heading('Bedroom')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(heading('Bathroom')).toHaveCount(0)
  // Opened again, and after a restart, it shows the bathroom only.
  for (const again of [() => library.click(), async () => (await page.reload(), await library.click())]) {
    await again()
    await expect(section('Bathroom')).toHaveClass(/active/)
    await expect(heading('Bathroom')).toBeVisible()
    await expect(heading('Bedroom')).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
  // In this drawing, which has no component of its own, is not opened on: All is.
  await library.click()
  await section('In this drawing').click()
  await page.keyboard.press('Escape')
  await library.click()
  await expect(section('All')).toHaveClass(/active/)
})

test('searches every section of the component library, and counts what each section holds', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  const dialog = page.getByRole('dialog', { name: 'Component library' })
  const search = page.getByPlaceholder('Search every object and component…')
  const count = (name: string) => librarySection(page, name).locator('.warehouse-count')
  await librarySection(page, 'Bathroom').click()
  await expect(page.locator('.warehouse-heading-name')).toHaveText(['Bathroom'])
  // A search looks through every section, wherever the library was, and each section says how much it found.
  await search.fill('fridge')
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Fridge', 'American fridge'])
  await expect(librarySection(page, 'All')).toHaveClass(/active/)
  await expect(count('Kitchen')).toHaveText('2')
  await expect(count('Bathroom')).toHaveText('0')
  // Cleared, it is back where it was.
  await search.fill('')
  await expect(librarySection(page, 'Bathroom')).toHaveClass(/active/)
  await expect(page.locator('.warehouse-heading-name')).toHaveText(['Bathroom'])
  // Nothing is confirmed in this window: its corner closes it.
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})

test('takes the components of a drawing on this computer from the foot of the component library', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  const other = drawing({
    stool: { id: 'stool', type: 'component', parent: null, order: 'a0', name: 'Stool' },
    seat: { id: 'seat', type: 'ellipse', parent: 'stool', order: 'a0', cx: 0, cy: 0, rx: 200, ry: 200 },
  })
  await choose(page, () => page.getByRole('button', { name: 'From a file…' }).click(), 'stools.opencalque', other)
  await expect(page.locator('.toast')).toContainText('Imported 1 component from stools.opencalque')
  // The library shows them where they now are.
  await expect(librarySection(page, 'In this drawing')).toHaveClass(/active/)
  await expect(page.locator('.warehouse-card strong')).toHaveText(['Stool'])
})

test('places the wall-hung toilet from the library in a drawing that took a double washbasin from where it was being made', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // While the double washbasin was being made it was the bathroom library's fifth component, and
  // drawings of that time hold it under that place.
  const plan = drawing({
    basin: { id: 'basin', type: 'component', parent: null, order: 'a0', name: 'Double washbasin', description: '1200 × 500', meta: { source: 'warehouse.bathroom#bathroom_5' } },
    counter: { id: 'counter', type: 'rect', parent: 'basin', order: 'a0', x: 0, y: 0, width: 1200, height: 500 },
  })
  await choose(page, () => page.keyboard.press('Control+o'), 'plan.opencalque', plan)
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Toilet, wall-hung$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + 400, box.y + 300)
  await page.keyboard.press('Escape')
  await expect(objectRows(page)).toHaveCount(1)
  await expect(objectRows(page).first()).toContainText('Toilet, wall-hung')
})

test('makes a group see-through from its properties, one drag of the slider being one step to undo', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  for (const [x, y] of [[300, 300], [450, 300]]) {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + x, box.y + y)
    await page.mouse.click(box.x + x + 100, box.y + y + 80)
  }
  await page.keyboard.press('v')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+g')
  await expect(objectRows(page).first()).toContainText('Group')
  const slider = page.locator('.opacity-slider input')
  const reading = page.locator('.opacity-slider > span')
  await expect(reading).toHaveText('100 %')
  await slider.fill('50')
  await expect(reading).toHaveText('50 %')
  // Dragged from its middle to near its start: many positions written, one step to undo.
  const track = (await slider.boundingBox())!
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2)
  await page.mouse.down()
  for (const share of [0.4, 0.3, 0.2]) await page.mouse.move(track.x + track.width * share, track.y + track.height / 2)
  await page.mouse.up()
  await expect(reading).not.toHaveText('50 %')
  await page.keyboard.press('Control+z')
  await expect(reading).toHaveText('50 %')
  await page.keyboard.press('Control+z')
  await expect(reading).toHaveText('100 %')
})

test('resizes a table by its side, the furniture installed before it could be', async ({ page }) => {
  // Installed as it was before it said how it is resized: the copy that ships now replaces it.
  const furniture = JSON.parse(readFileSync('apps/web/src/warehouse/extensions/furniture.json', 'utf8'))
  const old = { ...furniture, version: '1.0.0', objects: furniture.objects.map(({ box: _, ...object }: Record<string, unknown>) => object) }
  await startWith(page, { extensions: { installed: { [old.id]: old }, disabled: [] } })
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Table with chairs$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  // At the first zoom (0.1 px/mm, the origin at 320, 220): its corner at (1800, 2800) mm, 1800 long and 900 wide,
  // so on screen from x 500 to 680 and from y 500 to 590.
  await page.mouse.click(box.x + 500, box.y + 500)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Table with chairs' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('Length')).toHaveValue('1800')
  await page.mouse.move(box.x + 680, box.y + 545)
  await page.mouse.down()
  await page.mouse.move(box.x + 700, box.y + 548, { steps: 4 })
  await page.mouse.up()
  await expect(field('Length')).toHaveValue('2000')
  await expect(field('Width')).toHaveValue('900')
  await expect(field('X')).toHaveValue('1800')
})

test('stretches a placed component by a side of its frame, and gives it its proportions back', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  // A 2000 × 1000 rectangle from (-200, 800) mm, on screen from (300, 300) to (500, 400), made into a component placed there.
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  await expect(objectRows(page).first()).toContainText('Component 1')
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X')).toHaveValue('-200')
  const back = page.getByRole('button', { name: 'Back to its own proportions' })
  await expect(back).toHaveCount(0)
  // Its right side, 1000 mm further: half as wide again, its left side where it was.
  await page.mouse.move(box.x + 500, box.y + 350)
  await page.mouse.down()
  await page.mouse.move(box.x + 600, box.y + 352, { steps: 4 })
  await page.mouse.up()
  await expect(back).toBeVisible()
  await expect(field('X')).toHaveValue('-200')
  await back.click()
  await expect(back).toHaveCount(0)
})

test('vectorizes a stair into a component of its shapes from the right-click menu', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await page.getByTitle('Component library: stairs, furniture and every other object').click()
  await page.locator('.warehouse-card', { has: page.locator('strong', { hasText: /^Stair, straight$/ }) }).click()
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + 500, box.y + 600)
  await page.keyboard.press('Escape')
  await objectRows(page).filter({ hasText: 'Stair, straight' }).click()
  const field = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) })
  await expect(field('Steps')).toHaveCount(1)
  await page.mouse.click(box.x + 545, box.y + 450, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Vectorize' }).click()
  // A component placed where the stair was: its shapes to edit, no steps to set.
  await expect(field('Steps')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit component' })).toBeVisible()
  await expect(field('X').locator('input')).toHaveValue('1800')
})

test('turns a rectangle about its middle from the angle typed, and arranges it from the toolbar', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const label = (name: string) => page.locator('.field', { has: page.locator(`span:text-is("${name}")`) })
  const field = (name: string) => label(name).locator('input')
  // What it is called is changed in the Structure panel; stacking is in the toolbar.
  await expect(label('Name')).toHaveCount(0)
  await expect(label('Order')).toHaveCount(0)
  const x = Number(await field('X').inputValue())
  const y = Number(await field('Y').inputValue())
  await field('Rotation').fill('90')
  await field('Rotation').press('Enter')
  // 2000 by 1000 turned a quarter about its middle: the corner it is placed by goes round it.
  await expect(field('X')).toHaveValue(String(x + 1500))
  await expect(field('Y')).toHaveValue(String(y - 500))
  await page.getByTitle('Arrange: stacking order, align, space evenly').click()
  await expect(page.getByRole('menuitem', { name: 'Bring to front' })).toBeEnabled()
  await expect(page.getByRole('menuitem', { name: 'Align left' })).toBeDisabled()
})

test('shows in the Structure list what is picked on the drawing, however far down', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  // A floor at the bottom of the stacking order, so the last row, under 400 small squares.
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const key = (i: number) => `b${digits[Math.floor(i / 62)]}${digits[i % 62]}`
  const nodes: Record<string, unknown> = {
    floor: { id: 'floor', type: 'rect', name: 'Floor', parent: 'page_1', order: key(0), x: -20000, y: -20000, width: 40000, height: 40000, style: { fill: '#dddddd' } },
  }
  for (let i = 1; i <= 400; i++) nodes[`s${i}`] = { id: `s${i}`, type: 'rect', parent: 'page_1', order: key(i), x: 50000 + i * 10, y: 50000, width: 5, height: 5 }
  await choose(page, () => page.keyboard.press('Control+o'), 'many.opencalque', drawing(nodes))
  await page.locator('.dv-tab', { hasText: 'Structure' }).click()
  expect(await objectRows(page).count()).toBeLessThan(100)
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const floor = objectRows(page).filter({ hasText: 'Floor' })
  await expect(floor).toHaveClass(/selected/)
  await expect(floor).toBeInViewport()
})

test('changes the stacking order by dragging a row of the Structure list, and lists what an opened group holds', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const nodes = {
    under: { id: 'under', type: 'rect', name: 'Under', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 1000, height: 1000 },
    over: { id: 'over', type: 'rect', name: 'Over', parent: 'page_1', order: 'a2', x: 2000, y: 0, width: 1000, height: 1000 },
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a3' },
    inside: { id: 'inside', type: 'rect', name: 'Inside', parent: 'set', order: 'a0', x: 4000, y: 0, width: 500, height: 500 },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'order.opencalque', drawing(nodes))
  await page.locator('.dv-tab', { hasText: 'Structure' }).click()
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under'])
  await objectRows(page).filter({ hasText: 'Set' }).getByTitle('Show what is inside').click()
  await expect(objectRows(page)).toHaveText(['Set', 'Inside', 'Over', 'Under'])
  const under = objectRows(page).filter({ hasText: 'Under' })
  const over = objectRows(page).filter({ hasText: 'Over' })
  await under.dragTo(over, { targetPosition: { x: 40, y: 4 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Inside', 'Under', 'Over'])
})

test('puts an object in a group by dropping its row on the group, and takes one out the same way', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const nodes = {
    under: { id: 'under', type: 'rect', name: 'Under', parent: 'page_1', order: 'a1', x: 0, y: 0, width: 1000, height: 1000 },
    over: { id: 'over', type: 'rect', name: 'Over', parent: 'page_1', order: 'a2', x: 2000, y: 0, width: 1000, height: 1000 },
    set: { id: 'set', type: 'group', name: 'Set', parent: 'page_1', order: 'a3' },
    inside: { id: 'inside', type: 'rect', name: 'Inside', parent: 'set', order: 'a0', x: 4000, y: 0, width: 500, height: 500 },
  }
  await choose(page, () => page.keyboard.press('Control+o'), 'groups.opencalque', drawing(nodes))
  await page.locator('.dv-tab', { hasText: 'Structure' }).click()
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under'])
  // Dropped on the middle of the group's row: it goes in, on top of what the group holds, and the group opens to show it.
  const row = (name: string) => objectRows(page).filter({ hasText: new RegExp(`^${name}$`) })
  const height = (await row('Set').boundingBox())!.height
  await row('Over').dragTo(row('Set'), { targetPosition: { x: 60, y: height / 2 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Inside', 'Under'])
  await expect(row('Over')).toHaveCSS('padding-left', '22px')
  // A row inside the group, dropped below one on the page, comes out of it.
  await row('Inside').dragTo(row('Under'), { targetPosition: { x: 60, y: height - 3 } })
  await expect(objectRows(page)).toHaveText(['Set', 'Over', 'Under', 'Inside'])
  await expect(row('Inside')).toHaveCSS('padding-left', '8px')
})

test('with Shift, a dimension keeps level and stops on the line it crosses', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  // A rectangle whose right side is at x = 1800 mm (x = 500 on screen, 10 mm a pixel).
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  // From a point left of it, Shift held, the pointer a little past its right side and below the start.
  await page.keyboard.press('m')
  await page.mouse.click(box.x + 200, box.y + 350)
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 504, box.y + 356, { steps: 4 })
  await expect(page.locator('.status')).toContainText(/Distance 3\s?000 mm · ΔX 3\s?000 · ΔY 0/)
  await page.keyboard.up('Shift')
  await page.keyboard.press('Escape')

  await page.keyboard.press('d')
  await page.mouse.click(box.x + 200, box.y + 350)
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 504, box.y + 356, { steps: 4 })
  await page.mouse.click(box.x + 504, box.y + 356)
  await page.keyboard.up('Shift')
  await page.mouse.click(box.x + 504, box.y + 330)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(field('X2')).toHaveValue(/^1\s?800$/)
  await expect(field('Y2')).toHaveValue(/^1\s?300$/)
})

test('takes a thing out of a component: cut inside it, pasted on the page where the component drew it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  const field = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  await page.keyboard.press('Control+Alt+k')
  // The component placed elsewhere: its rectangle is drawn from (3000, 1000), 30 px a metre on screen... 10 mm a pixel.
  await field('X').fill('3000')
  await field('X').press('Enter')
  await field('Y').fill('1000')
  await field('Y').press('Enter')
  await page.mouse.dblclick(box.x + 720, box.y + 370)
  await objectRows(page).first().click()
  await expect(field('X')).toHaveValue('0')
  await page.keyboard.press('Control+x')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+v')
  // Two things on the page now: the placement of the emptied component, and the rectangle, on top, where it was seen.
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).first().click()
  await expect(field('X')).toHaveValue(/^3\s?000$/)
  await expect(field('Y')).toHaveValue(/^1\s?000$/)
})

test('shows the way into a group and a component in it, and goes back out to any place on it', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  await page.keyboard.press('r')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 500, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  // The rectangle made into a component, its placement then put in a group.
  await page.keyboard.press('Control+Alt+k')
  await page.keyboard.press('Control+g')
  const crumbs = page.locator('.breadcrumb .crumb:not(.ahead)')
  const left = page.locator('.breadcrumb .crumb.ahead')
  const selected = page.locator('[data-panel="objects"] .row.selected')
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await expect(crumbs).toHaveText(['Page 1', /Group/])
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await expect(crumbs).toHaveText(['Page 1', /Group/, 'Component 1'])
  await expect(page.locator('.hint-bar')).toContainText('insertion point')
  // Back to the group in one click, the placement gone into selected there and the component left
  // shown after it.
  await page.locator('.breadcrumb button.crumb', { hasText: 'Group' }).click()
  await expect(crumbs).toHaveText(['Page 1', /Group/])
  await expect(left).toHaveText(['Component 1'])
  await expect(selected).toHaveText(/Component 1/)
  // Out to the page, the group selected. The places left stay.
  await page.locator('.breadcrumb button.crumb', { hasText: 'Page 1' }).click()
  await expect(crumbs).toHaveText(['Page 1'])
  await expect(left).toHaveText([/Group/, 'Component 1'])
  await expect(selected).toHaveText(/Group/)
  // Straight back into the component, and out again a step at a time with Esc.
  await left.filter({ hasText: 'Component 1' }).click()
  await expect(crumbs).toHaveText(['Page 1', /Group/, 'Component 1'])
  await expect(left).toHaveCount(0)
  for (let i = 0; i < 4; i++) await page.keyboard.press('Escape')
  await expect(crumbs).toHaveText(['Page 1'])
  await expect(left).toHaveText([/Group/, 'Component 1'])
  // On the page with nothing selected, Esc lets go of them.
  await page.keyboard.press('Escape')
  await expect(page.locator('.breadcrumb')).toHaveCount(0)
  // After that, leaving offers back only what was just left.
  await page.mouse.dblclick(box.x + 400, box.y + 350)
  await page.keyboard.press('Escape')
  await expect(left).toHaveText([/Group/])
})

test('puts what is cut and pasted on top of what it was under', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  const rect = async (from: [number, number], to: [number, number]) => {
    await page.keyboard.press('r')
    await page.mouse.click(box.x + from[0], box.y + from[1])
    await page.mouse.click(box.x + to[0], box.y + to[1])
  }
  // The first under the second, which overlaps it: the list shows the topmost first.
  await rect([300, 300], [500, 400])
  await rect([350, 320], [550, 420])
  await page.keyboard.press('v')
  const x = page.locator('label.field', { has: page.locator('span:text-is("X")') }).locator('input')
  await objectRows(page).nth(1).click()
  await expect(x).toHaveValue('-200')
  await page.keyboard.press('Control+x')
  await page.keyboard.press('Control+v')
  await expect(objectRows(page)).toHaveCount(2)
  await objectRows(page).first().click()
  await expect(x).toHaveValue('-200')
})

test('measures and dimensions between the points clicked, not the grid points near them', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const box = (await canvas(page).boundingBox())!
  // At the first zoom the grid is 100 mm: these points, 4370 mm apart, are between its lines.
  await page.keyboard.press('m')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.move(box.x + 737, box.y + 300, { steps: 4 })
  await expect(page.locator('.status')).toContainText(/4\s?370/)
  await page.keyboard.press('Escape')

  await page.keyboard.press('d')
  await page.mouse.click(box.x + 300, box.y + 300)
  await page.mouse.click(box.x + 737, box.y + 300)
  await page.mouse.click(box.x + 737, box.y + 400)
  await page.keyboard.press('v')
  await objectRows(page).first().click()
  const x = (name: string) => page.locator('label.field', { has: page.locator(`span:text-is("${name}")`) }).locator('input')
  await expect(x('X2')).toHaveValue(/^4\s?170$/)
  await expect(x('X1')).toHaveValue('-200')
})

test('shows every value of a dimension style whole, in the narrow side panel', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Dimension styles')
  await page.keyboard.press('Enter')
  await page.locator('button[title="Add a dimension style"]').click()
  const panel = page.locator('[data-panel="dimensionStyles"]')
  const text = panel.locator('h4:has-text("Text") ~ .type-prop')
  const row = (name: string) => text.filter({ has: page.locator(`span:text-is("${name}")`) })
  for (const name of ['Font', 'Color']) {
    const box = row(name).locator('input[type=checkbox]').first()
    if (!(await box.isChecked())) await box.click()
  }
  // A colour defined by the style can be seen and chosen: its chooser was once hidden with the row's name.
  await expect(row('Color').locator('.color-now')).toBeVisible()
  // In a column of about 250 px the font goes under its name, with room for "Sans-serif" whole.
  const font = row('Font').locator('select')
  expect((await font.boundingBox())!.width).toBeGreaterThan(180)
})

test('imports a DXF of twenty thousand lines in a few seconds', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const lines = Array.from({ length: 20000 }, (_, i) => `0\nLINE\n8\n0\n10\n${i * 10}\n20\n0\n11\n${i * 10}\n21\n1000`).join('\n')
  const dxf = `0\nSECTION\n2\nENTITIES\n${lines}\n0\nENDSEC\n0\nEOF\n`
  const start = Date.now()
  await choose(page, () => page.keyboard.press('Control+i'), 'big.dxf', dxf)
  await expect(page.locator('.toast')).toContainText('Imported 20000 objects from big.dxf', { timeout: 15000 })
  expect(Date.now() - start).toBeLessThan(15000)
  // The structure lays out only the rows in sight, in a list as long as all twenty thousand:
  // laying them all out took seconds after every change.
  await page.locator('.dv-tab', { hasText: 'Structure' }).click()
  const panel = page.locator('.dock-panel[data-panel="objects"]')
  expect(await objectRows(page).count()).toBeLessThan(100)
  expect(await panel.evaluate((element) => element.scrollHeight)).toBeGreaterThan(20000 * 28)
  await panel.evaluate((element) => (element.scrollTop = element.scrollHeight))
  await expect(objectRows(page).last()).toBeInViewport()
  expect(await objectRows(page).count()).toBeLessThan(100)
})

test('offers back unsaved work after the window crashed', async ({ page, context, browser }) => {
  await startWith(page)
  await page.goto('/')
  await drawWall(page, [300, 300], [700, 300])
  // The copy is made a moment after the last change.
  await page.waitForTimeout(2500)
  // What the browser kept for the site, taken while the window is still open, as a crash would
  // leave it (a window closed normally takes its copy away), is what the next start finds.
  const kept = await context.storageState({ indexedDB: true })
  const later = await browser.newContext({ storageState: kept, viewport: { width: 1400, height: 900 } })
  const after = await later.newPage()
  after.on('pageerror', (error) => ((page as any).errors as string[]).push(error.message))
  // A blank page of the same site, to make the crashed window's last sign of life old enough to count as gone.
  await after.route('**/blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }))
  await after.goto('/blank')
  await after.evaluate(
    () =>
      new Promise<void>((done) => {
        const open = indexedDB.open('opencalque-recovery', 1)
        open.onsuccess = () => {
          const store = open.result.transaction('drawings', 'readwrite').objectStore('drawings')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const kept of all.result) store.put({ ...kept, alive: 0 })
            store.transaction.oncomplete = () => done()
          }
        }
      }),
  )
  await after.goto('/')
  const offered = after.locator('.welcome-recover-row')
  await expect(offered).toHaveCount(1)
  await offered.locator('button').first().click()
  await expect(after.locator('[data-panel="objects"] .row')).toHaveCount(1)
  // It is unsaved work again: the title says so.
  await expect(after).toHaveTitle(/^● /)
  await later.close()
})

test('tells the assistant what is selected, and applies what it answers', async ({ page }) => {
  await startWith(page, { ai: { provider: 'anthropic', anthropic: { apiKey: 'test-key', model: 'claude-opus-5-5' } } })
  const requests: string[] = []
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = request.postData() ?? ''
    requests.push(body)
    const events: unknown[] =
      requests.length === 1
        ? (() => {
            const id = /\\"(n_[a-z0-9]+)\\", a wall/.exec(body)?.[1] ?? 'missing'
            const input = JSON.stringify({ operations: [{ op: 'update_node', id, patch: { thickness: 300 } }] })
            return [
              { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'apply_operations', input: {} } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
            ]
          })()
        : [
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The wall is now 300 mm thick.' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
          ]
    const start = { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }
    const stream = [start, ...events, { type: 'message_stop' }].map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: stream })
  })
  await page.goto('/')
  await drawWall(page, [300, 300], [700, 300])
  await objectRows(page).first().click()
  await page.locator('.dv-tab', { hasText: 'Assistant' }).click()
  await expect(page.locator('.assistant-context')).toContainText('Wall')
  await page.locator('.assistant-composer textarea').fill('make this thicker')
  await page.keyboard.press('Enter')
  await expect(page.locator('.assistant-entry.assistant')).toContainText('300 mm thick')
  await expect(page.locator('.assistant-entry.activity').first()).toContainText('Applied 1 change')
  expect(requests[0]).toContain('<selection>')
  expect(requests[0]).toContain('length ')
  expect(requests[0]).toContain('make this thicker')

  // Left out, the selection is not sent with the next message.
  await page.locator('.assistant-context button').click()
  await page.locator('.assistant-composer textarea').fill('thanks')
  await page.keyboard.press('Enter')
  await expect.poll(() => requests.length).toBe(3)
  // Each request carries the conversation so far; what matters is the newest message.
  const newest = JSON.stringify(JSON.parse(requests[2]).messages.at(-1))
  expect(newest).toContain('thanks')
  expect(newest).toContain('chose not to send what is selected')
  expect(newest).not.toContain('<selection>')
})
