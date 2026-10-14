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
  await page.locator('.color-menu .color-option', { hasText: 'Colour of the layer “Layer 1”' }).click()
  // The field says what it follows, the whole of it: colour fields were cut to 72 pixels.
  await expect(fill.locator('.color-now')).toContainText('Layer 1')
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
  // The structure lists the first rows only: laying out twenty thousand took seconds after every change.
  await page.locator('.dv-tab', { hasText: 'Structure' }).click()
  await expect(page.locator('.more-rows')).toContainText('19700 more not listed')
  await page.locator('.more-rows button').click()
  await expect(page.locator('.more-rows')).toContainText('19400 more not listed')
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
