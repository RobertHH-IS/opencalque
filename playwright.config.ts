import { defineConfig, devices } from '@playwright/test'

/**
 * Tests of the editor as people use it: the production web build, served as opencalque.com serves
 * it (with its Content-Security-Policy), driven in Chromium with real clicks and keys. Run with
 * `pnpm e2e`, which builds first. The desktop shell adds only file dialogs and a window around
 * the same page; `pnpm smoke` drives it.
 */
export default defineConfig({
  testDir: 'e2e',
  // Not *.test.ts, which Vitest runs.
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: 'pnpm --filter @opencalque/web preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
