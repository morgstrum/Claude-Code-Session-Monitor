import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/types'
import { SessionMonitor } from './monitor'

let monitor: SessionMonitor | null = null

const FULL_MIN = { width: 720, height: 400 }
const COMPACT_MIN = { width: 260, height: 96 }
const COMPACT_SIZE = { width: 320, height: 460 }

/** Bounds of the full-view window, remembered while in compact mode */
let fullBounds: Electron.Rectangle | null = null
/** Window ids currently in compact mode */
const compactWindows = new Set<number>()
/** Last content height each renderer asked for (survives mode-switch races) */
const desiredHeights = new Map<number, number>()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: FULL_MIN.width,
    minHeight: FULL_MIN.height,
    title: 'Claude Code Session Monitor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function applyCompactSize(win: BrowserWindow): void {
  if (win.isDestroyed() || !compactWindows.has(win.id)) return
  const workArea = screen.getDisplayMatching(win.getBounds()).workArea
  const height = desiredHeights.get(win.id) ?? COMPACT_SIZE.height
  const clamped = Math.min(Math.max(Math.round(height), COMPACT_MIN.height), workArea.height)
  const width = win.getContentSize()[0] ?? COMPACT_SIZE.width
  win.setContentSize(width, clamped, false)
}

// Resizes are deliberately non-animated: macOS animates asynchronously, and a
// renderer height request landing mid-animation gets overwritten by the
// animation's final frame. The delayed re-apply covers window startup, where
// macOS applies only part of a resize issued while the window is still loading.
function setCompactMode(win: BrowserWindow, compact: boolean): void {
  if (compact) {
    compactWindows.add(win.id)
    fullBounds = win.getBounds()
    win.setMinimumSize(COMPACT_MIN.width, COMPACT_MIN.height)
    win.setSize(COMPACT_SIZE.width, COMPACT_SIZE.height, false)
    applyCompactSize(win)
    setTimeout(() => applyCompactSize(win), 250)
  } else {
    compactWindows.delete(win.id)
    win.setMinimumSize(FULL_MIN.width, FULL_MIN.height)
    if (fullBounds) win.setBounds(fullBounds, false)
    else win.setSize(1100, 720, false)
  }
}

/** Fit the compact window's content area to the renderer's measured height */
function setCompactHeight(win: BrowserWindow, height: number): void {
  desiredHeights.set(win.id, height)
  applyCompactSize(win)
}

app.whenReady().then(async () => {
  // Packaged builds get the icon from the app bundle; in dev the stock
  // Electron binary supplies its own, so set the dock icon at runtime.
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    if (!icon.isEmpty()) app.dock.setIcon(icon)
  }

  monitor = new SessionMonitor(join(app.getPath('userData'), 'sessions.db'))

  // Headless verification mode: parse everything, dump a snapshot, exit.
  if (process.env.SESSION_MONITOR_SMOKE === '1') {
    await monitor.start()
    await monitor.idle()
    const snap = monitor.snapshot()
    console.log(JSON.stringify(snap, null, 2))
    await monitor.stop()
    monitor = null
    app.exit(0)
    return
  }

  ipcMain.handle(IPC.getSessions, () => monitor!.snapshot())
  ipcMain.on(IPC.setCompactMode, (event, compact: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) setCompactMode(win, compact === true)
  })
  ipcMain.on(IPC.setAlwaysOnTop, (event, onTop: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setAlwaysOnTop(onTop === true, 'floating')
  })
  ipcMain.on(IPC.setCompactHeight, (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && typeof height === 'number' && Number.isFinite(height)) {
      setCompactHeight(win, height)
    }
  })
  ipcMain.on(IPC.setTheme, (_event, theme: string) => {
    // themeSource drives both prefers-color-scheme in the renderer and the
    // native window chrome, so light/dark/auto stays consistent everywhere
    nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
  })
  monitor.onUpdate((snap) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.sessionsUpdated, snap)
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Start after the window exists so the initial backfill streams into the UI
  await monitor.start()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  if (monitor) {
    event.preventDefault()
    const m = monitor
    monitor = null
    await m.stop()
    app.quit()
  }
})
