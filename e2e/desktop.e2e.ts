import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * The desktop app's own part, its main process: what only it does with files. Runs against the
 * built app (`pnpm build`); skipped when it has not been built, as in CI, which builds the web app only.
 */
const APP = resolve(__dirname, '../apps/desktop')
test.skip(!existsSync(join(APP, 'out/main/index.js')), 'Build the desktop app first (pnpm build).')

test('desktop: opens the file it is started with, saves over it with a backup and no temporary file left', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'opencalque-e2e-'))
  const folder = join(scratch, 'files')
  const profile = join(scratch, 'profile')
  const file = join(folder, 'plan.opencalque')
  const original = JSON.stringify({
    format: 'opencalque',
    version: 1,
    id: 'doc_x',
    name: 'Plan',
    unit: 'mm',
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', order: 'a0' } },
    nodes: {
      page_1: { id: 'page_1', type: 'page', name: 'Page 1', parent: null, order: 'a0' },
      w: { id: 'w', type: 'wall', parent: 'page_1', order: 'a1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, future: 'kept' },
    },
  })
  mkdirSync(folder)
  writeFileSync(file, original)
  // Agent terminals set this, which would start Electron as plain Node.
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [APP, `--user-data-dir=${profile}`, file], env, cwd: APP })
  try {
    const page = await app.firstWindow()
    const rows = page.locator('[data-panel="objects"] .row')
    await expect(rows).toHaveCount(1)
    const box = (await page.locator('.stage canvas').boundingBox())!
    const walls = () => readFileSync(file, 'utf8').match(/"type": "wall"/g)?.length ?? 0
    const drawAndSave = async (y: number) => {
      await page.keyboard.press('w')
      await page.mouse.click(box.x + 300, box.y + y)
      await page.mouse.click(box.x + 700, box.y + y)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+s')
    }

    await drawAndSave(400)
    await expect.poll(walls).toBe(2)
    // What this version does not know is kept.
    expect(JSON.parse(readFileSync(file, 'utf8')).nodes.w.future).toBe('kept')
    // The drawing as it was is in the backups, and nothing but the drawing is left beside it.
    const backups = readdirSync(join(profile, 'backups'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(profile, 'backups', backups[0]), 'utf8')).toBe(original)
    expect(readdirSync(folder)).toEqual(['plan.opencalque'])

    // One backup per run, however often it is saved.
    await drawAndSave(500)
    await expect.poll(walls).toBe(3)
    expect(readdirSync(join(profile, 'backups'))).toHaveLength(1)
  } finally {
    await app.close()
    rmSync(scratch, { recursive: true, force: true })
  }
})
