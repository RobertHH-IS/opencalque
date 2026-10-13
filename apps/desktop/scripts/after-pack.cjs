// Run by electron-builder once the app is assembled, before it goes into an installer.
//
// 1. Switches off what the app never uses in the Electron program it ships, so that the program
//    cannot be borrowed to run other code: started with ELECTRON_RUN_AS_NODE it would otherwise
//    be a plain Node, and NODE_OPTIONS or --inspect would let anyone load scripts into it. These
//    "fuses" are flipped here rather than through electron-builder's own `electronFuses` setting,
//    which flips them after this hook and so after the signature below, which it would break.
//
// 2. On macOS, signs the app "ad hoc". There is no Apple developer certificate to sign it with.
//    Left unsigned, the app is refused outright on Apple-silicon Macs ("the app is damaged and
//    can't be opened"), because assembling it invalidates the signature Electron itself came
//    with. Signing it with no identity makes it a valid app again: macOS then asks the usual
//    question about an app from an unidentified developer, which the user can answer.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const fuses = await context.packager.generateFuseConfig({
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
  })
  await context.packager.addElectronFuses(context, fuses)

  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  // Fails the build here rather than on a user's Mac if the result is not a valid app.
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}
