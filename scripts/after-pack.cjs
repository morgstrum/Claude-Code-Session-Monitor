// electron-builder afterPack hook: ad-hoc sign macOS bundles.
//
// We have no Apple Developer ID, so electron-builder's own signing is
// disabled (mac.identity: null). But a fully unsigned app downloaded from
// the internet is reported by Gatekeeper as "damaged"; an ad-hoc signed one
// gets the friendlier "unidentified developer" / Open Anyway flow instead.
const { execFileSync } = require('child_process')
const path = require('path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${appName}`)
}
