// Build the app for this machine and install it into /Applications (macOS).
// Locally built apps carry no quarantine attribute, so Gatekeeper never
// complains — the smoothest install path when working from a clone.
//
//   npm run install:app
import { execSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

if (process.platform !== 'darwin') {
  console.error(
    'install:app currently supports macOS only.\n' +
      'On Windows run `npm run dist:win` and use the installer from release/;\n' +
      'on Linux run `npm run dist:linux` and use the AppImage from release/.'
  )
  process.exit(1)
}

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
console.log(`Building for macOS ${arch}…`)
run('npx electron-vite build')
// --dir produces just the .app (no dmg/zip) — much faster than a full dist
run(`npx electron-builder --mac --dir --${arch} --publish never`)

const appName = 'Claude Code Session Monitor.app'
const built = join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', appName)
if (!existsSync(built)) {
  console.error(`Build output not found at ${built}`)
  process.exit(1)
}

const target = join('/Applications', appName)
if (existsSync(target)) {
  console.log(`Removing existing ${target}…`)
  try {
    execSync(`osascript -e 'tell application "Claude Code Session Monitor" to quit'`, {
      stdio: 'ignore',
      timeout: 5000
    })
  } catch {
    // wasn't running
  }
  rmSync(target, { recursive: true, force: true })
}

console.log(`Installing to ${target}…`)
// ditto preserves signatures, permissions, and extended attributes
run(`ditto "${built}" "${target}"`)

console.log(`\nInstalled. Launch with:  open -a "Claude Code Session Monitor"`)
