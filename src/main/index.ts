import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/types'
import { SessionMonitor } from './monitor'

let monitor: SessionMonitor | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 400,
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

app.whenReady().then(async () => {
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
