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

test('imports a DXF of twenty thousand lines in a few seconds', async ({ page }) => {
  await startWith(page)
  await page.goto('/')
  const lines = Array.from({ length: 20000 }, (_, i) => `0\nLINE\n8\n0\n10\n${i * 10}\n20\n0\n11\n${i * 10}\n21\n1000`).join('\n')
  const dxf = `0\nSECTION\n2\nENTITIES\n${lines}\n0\nENDSEC\n0\nEOF\n`
  const start = Date.now()
  await choose(page, () => page.keyboard.press('Control+i'), 'big.dxf', dxf)
  await expect(page.locator('.toast')).toContainText('Imported 20000 objects from big.dxf', { timeout: 15000 })
  expect(Date.now() - start).toBeLessThan(15000)
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
