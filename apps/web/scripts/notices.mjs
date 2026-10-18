// Writes THIRD-PARTY-NOTICES.txt at the root of the repository: the licence of every package of
// others that the editor's build and the desktop app's main process hold, found by building them,
// and of the fonts that ship with it. The web app shows the file under About, and the installers
// carry it beside the app.
//
//   pnpm notices           writes the file
//   pnpm notices --check   fails when the file is not what the build holds now (CI runs this)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(web, '../..')
const out = join(root, 'THIRD-PARTY-NOTICES.txt')

// The folder of the package a module of the build comes from, when it comes from node_modules.
const PACKAGE = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/

/** A plugin that adds to `folders` the package of every module a build holds. */
const collect = (folders) => ({
  name: 'opencalque-notices',
  generateBundle() {
    for (const id of this.getModuleIds()) {
      const folder = PACKAGE.exec(id.replace(/^\0/, '').split('?')[0])?.[1]
      if (folder) folders.add(folder)
    }
  },
})

/**
 * The folders of the packages whose code the builds hold: the editor's, and the desktop app's main
 * process (electron-updater and what it uses), which electron-vite bundles whole but for Electron
 * and Node's own modules.
 */
async function bundled() {
  const folders = new Set()
  await build({ root: web, configFile: join(web, 'vite.config.ts'), logLevel: 'error', build: { write: false }, plugins: [collect(folders)] })
  const desktop = join(root, 'apps/desktop')
  await build({
    root: desktop,
    configFile: false,
    logLevel: 'error',
    build: { write: false, ssr: join(desktop, 'src/main/index.ts'), rollupOptions: { external: ['electron', /^node:/, ...builtinModules] } },
    ssr: { noExternal: true },
    plugins: [collect(folders)],
  })
  return [...folders]
}

/** The licence files a package carries: its licence, and the notice an Apache licence asks to pass on. */
function licenceTexts(folder) {
  return readdirSync(folder)
    .filter((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name))
    .sort()
    .map((name) => read(join(folder, name)))
}

/**
 * For a package that carries no licence file: the comment at the head of its main file, when that
 * is where it says its licence (Clipper); for one under MIT that says nothing more, the MIT
 * licence as this repository's LICENSE words it, with the package's author as the holder.
 */
function fallbackTexts(folder, pkg, licence) {
  const main = [pkg.main, `${pkg.main}.js`, 'index.js'].map((name) => name && join(folder, name)).find((file) => file && existsSync(file) && !file.endsWith(folder))
  const head = main ? /^\s*\/\*[\s\S]*?\*\//.exec(read(main))?.[0] : undefined
  if (head && /licen[cs]e/i.test(head)) return [head]
  if (licence !== 'MIT') return []
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  return [read(join(root, 'LICENSE')).replace(/^Copyright .*$/m, `Copyright (c) ${author ?? `the authors of ${pkg.name}`}`)]
}

/** A text file, with its line ends as they are written in the repository. */
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim()

const RULE = '='.repeat(78)
const entry = (title, licence, texts) => [RULE, title, licence, '', ...(texts.length > 0 ? texts : ['(The package carries no licence file; its licence is the one named above.)']), ''].join('\n')

const packages = new Map()
for (const folder of await bundled()) {
  const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))
  // The workspace's own packages are OpenCalque, under its own licence.
  if (pkg.name.startsWith('@opencalque/')) continue
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see below')
  const home = pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? ''
  const texts = licenceTexts(folder)
  packages.set(`${pkg.name}@${pkg.version}`, entry(`${pkg.name} ${pkg.version}`, `Licence: ${licence}${home ? `  ${home.replace(/^git\+/, '')}` : ''}`, texts.length > 0 ? texts : fallbackTexts(folder, pkg, licence)))
}

const fonts = readdirSync(join(root, 'fonts'))
  .filter((name) => /^OFL-.+\.txt$/.test(name))
  .sort()
  .map((name) => {
    const family = name.slice(4, -4).replace(/^NotoSans/, 'Noto Sans ').trim()
    return entry(`${family} (font, in fonts/${name.slice(4, -4)}-Regular.ttf)`, 'Licence: OFL-1.1', [read(join(root, 'fonts', name))])
  })

const text = [
  'OpenCalque is free software under the MIT licence (LICENSE). It includes the following software',
  'and fonts by others, each under its own licence. The fonts were cut down to their regular weight',
  'for the app, as fonts/README.md describes.',
  '',
  ...[...packages.keys()].sort().map((key) => packages.get(key)),
  ...fonts,
].join('\n')
  .trimEnd()
  .concat('\n')

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== text) {
    console.error('THIRD-PARTY-NOTICES.txt is not what the build holds now: run `pnpm notices` and commit the result.')
    process.exit(1)
  }
  console.log(`THIRD-PARTY-NOTICES.txt is up to date (${packages.size} packages, ${fonts.length} fonts).`)
} else {
  writeFileSync(out, text)
  console.log(`Wrote THIRD-PARTY-NOTICES.txt: ${packages.size} packages, ${fonts.length} fonts.`)
}
